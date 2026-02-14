import { encodeFunctionData } from 'viem'
import type { Address, Hex } from 'viem'
import { AEQUI_EXECUTOR_ABI, V2_ROUTER_ABI, V3_ROUTER_ABI, V3_ROUTER02_ABI, WETH_ABI } from './abi'
import type { ChainConfig, ChainKey, PriceQuote, TokenMetadata } from './types'

interface ExecutorCallPlan {
  target: Address
  allowFailure: boolean
  callData: Hex
  value?: bigint
}

export interface SwapBuilderConfig {
  executorByChain: Record<ChainKey, Address | null>
  interhopBufferBps: number
}

export interface SwapBuildParams {
  quote: PriceQuote
  amountOutMin: bigint
  recipient: Address
  slippageBps: number
  deadlineSeconds: number
  useNativeInput?: boolean
  useNativeOutput?: boolean
}

export interface SwapTransaction {
  kind: 'executor'
  dexId: string
  router: Address
  spender: Address
  amountIn: bigint
  amountOut: bigint
  amountOutMinimum: bigint
  deadline: number
  calls: ExecutorCallPlan[]
  call: {
    to: Address
    data: Hex
    value: bigint
  }
  executor: {
    pulls: { token: Address; amount: bigint }[]
    approvals: { token: Address; spender: Address; amount: bigint; revokeAfter: boolean }[]
    calls: { target: Address; value: bigint; data: Hex; injectToken: Address; injectOffset: bigint }[]
    tokensToFlush: Address[]
  }
}

const clampSlippage = (value: number): number => {
  if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) {
    return 0
  }
  if (value > 1000) {
    return 1000
  }
  return Math.floor(value)
}

const encodeV3Path = (tokens: Address[], fees: number[]): Hex => {
  if (tokens.length < 2) {
    throw new Error('V3 path requires at least two tokens')
  }
  if (fees.length !== tokens.length - 1) {
    throw new Error('V3 path fee mismatch')
  }

  let concatenated = ''
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!.toLowerCase().replace(/^0x/, '')
    concatenated += token
    if (index < fees.length) {
      const feeHex = fees[index]!.toString(16).padStart(6, '0')
      concatenated += feeHex
    }
  }

  return `0x${concatenated}` as Hex
}

export class SwapBuilder {
  private readonly interhopBufferBps: number

  constructor(private readonly config: SwapBuilderConfig) {
    this.interhopBufferBps = config.interhopBufferBps > 0 ? Math.floor(config.interhopBufferBps) : 0
  }

  build(chain: ChainConfig, params: SwapBuildParams): SwapTransaction {
    if (!params.quote.sources.length) {
      throw new Error('Quote is missing source information')
    }

    const deadlineSeconds = params.deadlineSeconds > 0 ? params.deadlineSeconds : 180
    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds
    const boundedSlippage = clampSlippage(params.slippageBps)
    const amountOutMinimum = params.amountOutMin > 0n
      ? params.amountOutMin
      : this.applySlippage(params.quote.amountOut, boundedSlippage)

    if (params.quote.isSplit && params.quote.splits?.length) {
      return this.buildSplitExecutorSwap(
        chain,
        params.quote,
        params.recipient,
        amountOutMinimum,
        BigInt(deadline),
        params.useNativeInput,
        params.useNativeOutput,
      )
    }

    return this.buildExecutorSwap(
      chain,
      params.quote,
      params.recipient,
      amountOutMinimum,
      BigInt(deadline),
      params.useNativeInput,
      params.useNativeOutput,
    )
  }

  private applySlippage(amount: bigint, slippageBps: number): bigint {
    if (amount === 0n || slippageBps <= 0) {
      return amount
    }
    const penalty = (amount * BigInt(slippageBps)) / 10000n
    return amount > penalty ? amount - penalty : 0n
  }

  private buildExecutorSwap(
    chain: ChainConfig,
    quote: PriceQuote,
    recipient: Address,
    amountOutMin: bigint,
    deadline: bigint,
    useNativeInput?: boolean,
    useNativeOutput?: boolean,
  ): SwapTransaction {
    const executorAddress = this.resolveExecutor(chain.key, chain.name)

    const inputToken = quote.path[0]
    if (!inputToken) {
      throw new Error('Quote is missing input token metadata')
    }

    const pulls: { token: Address; amount: bigint }[] = []
    if (!useNativeInput) {
      pulls.push({ token: inputToken.address, amount: quote.amountIn })
    }

    const approvals: { token: Address; spender: Address; amount: bigint; revokeAfter: boolean }[] = []
    const executorCalls: { target: Address; value: bigint; data: Hex; injectToken: Address; injectOffset: bigint }[] = []
    const tokensToFlush = new Set<Address>()
    if (!useNativeInput) {
      tokensToFlush.add(inputToken.address)
    }

    const calls: ExecutorCallPlan[] = []
    let availableAmount = quote.amountIn

    if (useNativeInput) {
      if (!chain.wrappedNativeAddress) {
        throw new Error(`Wrapped native address not configured for chain ${chain.name}`)
      }
      
      const wrapCallData = encodeFunctionData({
        abi: WETH_ABI,
        functionName: 'deposit',
        args: [],
      })

      const wrapCall = {
        target: chain.wrappedNativeAddress,
        value: quote.amountIn,
        data: wrapCallData,
        injectToken: '0x0000000000000000000000000000000000000000' as Address,
        injectOffset: 0n,
      }
      
      executorCalls.push(wrapCall)
      tokensToFlush.add(chain.wrappedNativeAddress)
    }

    for (let index = 0; index < quote.sources.length; index += 1) {
      const source = quote.sources[index]
      if (!source) {
        throw new Error('Route source metadata missing for executor construction')
      }
      const tokenIn = quote.path[index] as TokenMetadata | undefined
      const tokenOut = quote.path[index + 1] as TokenMetadata | undefined
      const hopVersion = quote.hopVersions[index]
      if (!tokenIn || !tokenOut) {
        throw new Error('Route token metadata missing for executor construction')
      }
      if (!hopVersion) {
        throw new Error('Route hop version missing for executor construction')
      }

      const dex = chain.dexes.find((entry) => entry.id === source.dexId)
      if (!dex) {
        throw new Error(`DEX ${source.dexId} is not configured for chain ${chain.name}`)
      }

      const quotedHopAmountIn = source.amountIn
      if (!quotedHopAmountIn || quotedHopAmountIn <= 0n) {
        throw new Error('Missing hop amountIn for executor construction')
      }

      if (availableAmount <= 0n) {
        throw new Error('Insufficient rolling amount for executor construction')
      }

      let hopAmountIn = quotedHopAmountIn <= availableAmount ? quotedHopAmountIn : availableAmount

      if (index > 0 && this.interhopBufferBps > 0 && hopAmountIn > 0n) {
        const buffer = (hopAmountIn * BigInt(this.interhopBufferBps)) / 10_000n
        if (buffer > 0n && buffer < hopAmountIn) {
          hopAmountIn -= buffer
        }
      }

      if (hopAmountIn <= 0n) {
        throw new Error('Computed hop amountIn is non-positive after buffer adjustment')
      }

      const isLastHop = index === quote.sources.length - 1
      // If unwrapping at the end, the last hop must send tokens to the executor
      const hopRecipient = (isLastHop && !useNativeOutput) ? recipient : executorAddress
      const hopExpectedOut = source.amountOut
      if (!hopExpectedOut || hopExpectedOut <= 0n) {
        throw new Error('Missing hop amountOut for executor construction')
      }
      const scaledHopExpectedOut = (hopExpectedOut * hopAmountIn) / quotedHopAmountIn

      const hopMinOut = this.deriveHopMinOut(
        scaledHopExpectedOut,
        amountOutMin,
        quote.amountOut,
        isLastHop,
      )

      const isIntermediateHop = index > 0
      const approvalAmount = isIntermediateHop
        ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') // max uint256
        : hopAmountIn // exact amount for first hop

      approvals.push({
        token: tokenIn.address,
        spender: dex.routerAddress,
        amount: approvalAmount,
        revokeAfter: true,
      })

      const swapCallData = hopVersion === 'v2'
        ? this.encodeV2SingleHopCall(tokenIn.address, tokenOut.address, hopAmountIn, hopMinOut, hopRecipient, deadline)
        : this.encodeV3SingleHopCall(tokenIn.address, tokenOut.address, source.feeTier, hopAmountIn, hopMinOut, hopRecipient, deadline, dex.useRouter02)

      // Dynamic Injection for multi-hop
      // For the first hop (index 0), we use the fixed amountIn.
      // For subsequent hops, we must inject the output of the previous hop (which is the current tokenIn balance).
      const isInjectionNeeded = index > 0
      const injectToken = isInjectionNeeded ? tokenIn.address : '0x0000000000000000000000000000000000000000' as Address
      
      let injectOffset = 0n
      if (isInjectionNeeded) {
        if (hopVersion === 'v2') {
          // swapExactTokensForTokens(amountIn, ...) -> amountIn is at offset 4
          injectOffset = 4n
        } else if (dex.useRouter02) {
          // Router02: exactInputSingle(params) -> params.amountIn is at offset 4 + (4 * 32) = 132
          // (tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96)
          injectOffset = 132n
        } else {
          // Standard V3: exactInputSingle(params) -> params.amountIn is at offset 4 + (5 * 32) = 164
          // (tokenIn, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum, sqrtPriceLimitX96)
          injectOffset = 164n
        }
      }

      const plannedCall = {
        target: dex.routerAddress,
        value: 0n,
        data: swapCallData,
        injectToken,
        injectOffset,
      }

      executorCalls.push(plannedCall)
      tokensToFlush.add(tokenIn.address)
      
      // Only flush output token if it's coming back to executor (not going directly to recipient)
      if (hopRecipient === executorAddress) {
        tokensToFlush.add(tokenOut.address)
      }
      
      calls.push({
        target: plannedCall.target,
        allowFailure: false,
        callData: plannedCall.data,
        value: plannedCall.value,
      })

      availableAmount = scaledHopExpectedOut
    }

    if (useNativeOutput) {
      if (!chain.wrappedNativeAddress) {
        throw new Error(`Wrapped native address not configured for chain ${chain.name}`)
      }

      const unwrapCallData = encodeFunctionData({
        abi: WETH_ABI,
        functionName: 'withdraw',
        args: [0n], // Amount will be injected
      })

      const unwrapCall = {
        target: chain.wrappedNativeAddress,
        value: 0n,
        data: unwrapCallData,
        injectToken: chain.wrappedNativeAddress,
        injectOffset: 4n, // Offset of 'amount' parameter
      }

      executorCalls.push(unwrapCall)
      tokensToFlush.add(chain.wrappedNativeAddress)
    }

    const executorData = encodeFunctionData({
      abi: AEQUI_EXECUTOR_ABI,
      functionName: 'execute',
      args: [
        pulls,
        approvals,
        executorCalls,
        Array.from(tokensToFlush),
      ],
    })

    return {
      kind: 'executor',
      dexId: quote.sources.length === 1 ? quote.sources[0]!.dexId : 'multi',
      router: executorAddress,
      spender: executorAddress,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      amountOutMinimum: amountOutMin,
      deadline: Number(deadline),
      calls,
      call: {
        to: executorAddress,
        data: executorData,
        value: useNativeInput ? quote.amountIn : 0n,
      },
      executor: {
        pulls,
        approvals,
        calls: executorCalls,
        tokensToFlush: Array.from(tokensToFlush),
      },
    }
  }

  private buildSplitExecutorSwap(
    chain: ChainConfig,
    quote: PriceQuote,
    recipient: Address,
    amountOutMin: bigint,
    deadline: bigint,
    useNativeInput?: boolean,
    useNativeOutput?: boolean,
  ): SwapTransaction {
    const splits = quote.splits!
    if (splits.length < 2) {
      throw new Error('Split quote must have at least 2 legs')
    }

    const executorAddress = this.resolveExecutor(chain.key, chain.name)
    const inputToken = quote.path[0]
    if (!inputToken) {
      throw new Error('Quote is missing input token metadata')
    }

    const pulls: SwapTransaction['executor']['pulls'] = []
    if (!useNativeInput) {
      pulls.push({ token: inputToken.address, amount: quote.amountIn })
    }

    const approvals: SwapTransaction['executor']['approvals'] = []
    const executorCalls: SwapTransaction['executor']['calls'] = []
    const tokensToFlush = new Set<Address>()
    const calls: ExecutorCallPlan[] = []

    if (!useNativeInput) {
      tokensToFlush.add(inputToken.address)
    }

    if (useNativeInput) {
      if (!chain.wrappedNativeAddress) {
        throw new Error(`Wrapped native address not configured for chain ${chain.name}`)
      }
      executorCalls.push({
        target: chain.wrappedNativeAddress,
        value: quote.amountIn,
        data: encodeFunctionData({ abi: WETH_ABI, functionName: 'deposit', args: [] }),
        injectToken: '0x0000000000000000000000000000000000000000' as Address,
        injectOffset: 0n,
      })
      tokensToFlush.add(chain.wrappedNativeAddress)
    }

    const userSlippageBps = quote.amountOut > 0n
      ? ((quote.amountOut - amountOutMin) * 10000n) / quote.amountOut
      : 50n
    const splitLegSlippageBps = userSlippageBps < 100n ? 100n : userSlippageBps

    let allocatedIn = 0n

    for (let legIdx = 0; legIdx < splits.length; legIdx++) {
      const leg = splits[legIdx]!
      const legQuote = leg.quote
      const isLastLeg = legIdx === splits.length - 1

      const legAmountIn = isLastLeg
        ? quote.amountIn - allocatedIn
        : legQuote.amountIn
      allocatedIn += legAmountIn

      const legMinOut = legQuote.amountOut > 0n
        ? legQuote.amountOut - (legQuote.amountOut * splitLegSlippageBps) / 10000n
        : 0n

      let availableAmount = legAmountIn

      for (let hopIdx = 0; hopIdx < legQuote.sources.length; hopIdx++) {
        const source = legQuote.sources[hopIdx]!
        const hopTokenIn = legQuote.path[hopIdx]!
        const hopTokenOut = legQuote.path[hopIdx + 1]!
        const hopVersion = legQuote.hopVersions[hopIdx]!

        const dex = chain.dexes.find((d) => d.id === source.dexId)
        if (!dex) {
          throw new Error(`DEX ${source.dexId} not configured for chain ${chain.name}`)
        }

        const quotedHopAmountIn = source.amountIn
        if (!quotedHopAmountIn || quotedHopAmountIn <= 0n) {
          throw new Error('Missing hop amountIn for split executor construction')
        }

        let hopAmountIn = hopIdx === 0 ? legAmountIn : availableAmount

        if (hopIdx > 0 && this.interhopBufferBps > 0 && hopAmountIn > 0n) {
          const buffer = (hopAmountIn * BigInt(this.interhopBufferBps)) / 10_000n
          if (buffer > 0n && buffer < hopAmountIn) {
            hopAmountIn -= buffer
          }
        }

        const isLastHopOfLeg = hopIdx === legQuote.sources.length - 1
        const scaledHopExpectedOut = (source.amountOut * hopAmountIn) / quotedHopAmountIn
        const hopMinOut = this.deriveHopMinOut(scaledHopExpectedOut, legMinOut, legQuote.amountOut, isLastHopOfLeg)
        const hopRecipient = executorAddress

        approvals.push({
          token: hopTokenIn.address,
          spender: dex.routerAddress,
          amount: hopIdx > 0
            ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
            : hopAmountIn,
          revokeAfter: true,
        })

        const swapCallData = hopVersion === 'v2'
          ? this.encodeV2SingleHopCall(hopTokenIn.address, hopTokenOut.address, hopAmountIn, hopMinOut, hopRecipient, deadline)
          : this.encodeV3SingleHopCall(hopTokenIn.address, hopTokenOut.address, source.feeTier, hopAmountIn, hopMinOut, hopRecipient, deadline, dex.useRouter02)

        const isInjectionNeeded = hopIdx > 0
        const injectToken = isInjectionNeeded
          ? hopTokenIn.address
          : '0x0000000000000000000000000000000000000000' as Address

        let injectOffset = 0n
        if (isInjectionNeeded) {
          if (hopVersion === 'v2') {
            injectOffset = 4n
          } else if (dex.useRouter02) {
            injectOffset = 132n
          } else {
            injectOffset = 164n
          }
        }

        executorCalls.push({
          target: dex.routerAddress,
          value: 0n,
          data: swapCallData,
          injectToken,
          injectOffset,
        })

        tokensToFlush.add(hopTokenIn.address)
        tokensToFlush.add(hopTokenOut.address)

        calls.push({
          target: dex.routerAddress,
          allowFailure: false,
          callData: swapCallData,
          value: 0n,
        })

        availableAmount = scaledHopExpectedOut
      }
    }

    if (useNativeOutput) {
      if (!chain.wrappedNativeAddress) {
        throw new Error(`Wrapped native address not configured for chain ${chain.name}`)
      }
      executorCalls.push({
        target: chain.wrappedNativeAddress,
        value: 0n,
        data: encodeFunctionData({ abi: WETH_ABI, functionName: 'withdraw', args: [0n] }),
        injectToken: chain.wrappedNativeAddress,
        injectOffset: 4n,
      })
      tokensToFlush.add(chain.wrappedNativeAddress)
    }

    const mergedApprovals = this.mergeApprovals(approvals)

    const executorData = encodeFunctionData({
      abi: AEQUI_EXECUTOR_ABI,
      functionName: 'execute',
      args: [pulls, mergedApprovals, executorCalls, Array.from(tokensToFlush)],
    })

    return {
      kind: 'executor',
      dexId: 'split',
      router: executorAddress,
      spender: executorAddress,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      amountOutMinimum: amountOutMin,
      deadline: Number(deadline),
      calls,
      call: {
        to: executorAddress,
        data: executorData,
        value: useNativeInput ? quote.amountIn : 0n,
      },
      executor: {
        pulls,
        approvals: mergedApprovals,
        calls: executorCalls,
        tokensToFlush: Array.from(tokensToFlush),
      },
    }
  }

  private deriveHopMinOut(
    hopExpectedOut: bigint,
    totalMinOut: bigint,
    totalExpectedOut: bigint,
    isLastHop: boolean,
  ): bigint {
    if (isLastHop) {
      return totalMinOut
    }
    if (totalExpectedOut === 0n || hopExpectedOut === 0n) {
      return 0n
    }
    return (hopExpectedOut * totalMinOut) / totalExpectedOut
  }

  private encodeV2SwapCall(
    quote: PriceQuote,
    recipient: Address,
    amountOutMin: bigint,
    deadline: bigint,
  ): Hex {
    return encodeFunctionData({
      abi: V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [quote.amountIn, amountOutMin, quote.routeAddresses, recipient, deadline],
    })
  }

  private encodeV3SwapCall(
    quote: PriceQuote,
    recipient: Address,
    amountOutMin: bigint,
    deadline: bigint,
  ): Hex {
    if (!quote.hopVersions.every((version) => version === 'v3')) {
      throw new Error('Mixed-version routes are not supported for V3 calldata')
    }

    const fees = quote.sources.map((source) => {
      if (typeof source.feeTier !== 'number') {
        throw new Error('Missing fee tier for V3 route')
      }
      return source.feeTier
    })

    if (fees.length !== quote.routeAddresses.length - 1) {
      throw new Error('Fee tiers do not match V3 path length')
    }

    if (quote.routeAddresses.length === 2) {
      return encodeFunctionData({
        abi: V3_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: quote.routeAddresses[0]!,
            tokenOut: quote.routeAddresses[1]!,
            fee: fees[0]!,
            recipient,
            deadline,
            amountIn: quote.amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0n,
          },
        ],
      })
    }

    const path = encodeV3Path(quote.routeAddresses, fees)
    return encodeFunctionData({
      abi: V3_ROUTER_ABI,
      functionName: 'exactInput',
      args: [
        {
          path,
          recipient,
          deadline,
          amountIn: quote.amountIn,
          amountOutMinimum: amountOutMin,
        },
      ],
    })
  }

  private encodeV2SingleHopCall(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    amountOutMin: bigint,
    recipient: Address,
    deadline: bigint,
  ): Hex {
    return encodeFunctionData({
      abi: V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [amountIn, amountOutMin, [tokenIn, tokenOut], recipient, deadline],
    })
  }

  private encodeV3SingleHopCall(
    tokenIn: Address,
    tokenOut: Address,
    feeTier: number | undefined,
    amountIn: bigint,
    amountOutMin: bigint,
    recipient: Address,
    deadline: bigint,
    useRouter02?: boolean,
  ): Hex {
    if (typeof feeTier !== 'number') {
      throw new Error('Missing fee tier for V3 hop')
    }

    // Router02 (Uniswap V3): no deadline in struct — deadline is enforced
    // by the executor's atomic execution + server-side TTL expiry check.
    // For standalone (non-executor) calls, use multicall(deadline, data[]) wrapper.
    if (useRouter02) {
      return encodeFunctionData({
        abi: V3_ROUTER02_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn,
            tokenOut,
            fee: feeTier,
            recipient,
            amountIn,
            amountOutMinimum: amountOutMin,
            sqrtPriceLimitX96: 0n,
          },
        ],
      })
    }

    // Standard V3 Router (PancakeSwap) includes deadline in struct
    return encodeFunctionData({
      abi: V3_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn,
          tokenOut,
          fee: feeTier,
          recipient,
          deadline,
          amountIn,
          amountOutMinimum: amountOutMin,
          sqrtPriceLimitX96: 0n,
        },
      ],
    })
  }

  private mergeApprovals(
    approvals: SwapTransaction['executor']['approvals'],
  ): SwapTransaction['executor']['approvals'] {
    const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
    const map = new Map<string, SwapTransaction['executor']['approvals'][0]>()

    for (const a of approvals) {
      const key = `${a.token.toLowerCase()}:${a.spender.toLowerCase()}`
      const existing = map.get(key)
      if (existing) {
        if (existing.amount < MAX_UINT256 && a.amount < MAX_UINT256) {
          existing.amount += a.amount
        } else {
          existing.amount = MAX_UINT256
        }
      } else {
        map.set(key, { ...a })
      }
    }

    return Array.from(map.values())
  }

  private resolveExecutor(chain: ChainKey, chainName: string): Address {
    const executor = this.config.executorByChain[chain]
    if (!executor) {
      throw new Error(`Executor not configured for chain ${chainName}`)
    }
    return executor
  }
}
