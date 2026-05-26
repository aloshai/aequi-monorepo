/**
 * SettlerBackend — turns a `SwapPlan` into Settler calldata.
 *
 * Scope of this initial implementation:
 *   - AllowanceHolder mode (Permit2 mode is a TODO; see end of file).
 *   - Single-hop and multi-hop swaps across UniswapV2 / UniswapV3 forks
 *     (covers Uniswap V2/V3, PancakeSwap V2/V3, Incentive Portal V3).
 *   - Native input/output via WETH wrap/unwrap (BASIC actions).
 *   - Fee skim via POSITIVE_SLIPPAGE.
 *
 * Out of scope (not yet implemented):
 *   - Permit2 mode (TODO_PERMIT2).
 *   - Split routes (TODO_SPLITS) — quote.isSplit throws.
 *   - UniswapV4 (handled in a later plan).
 *
 * Action list layout (AllowanceHolder mode):
 *   [0]   optional WRAP (BASIC -> WETH.deposit) if useNativeInput
 *   [1..] swap actions, one per route hop
 *           - first hop bps = SETTLER_BPS_FULL (consume the pulled amount)
 *           - subsequent hops bps = SETTLER_BPS_FULL (consume previous hop output)
 *   [N]   optional UNWRAP (BASIC -> WETH.withdraw) if useNativeOutput
 *   [N+1] optional POSITIVE_SLIPPAGE for fee skim
 *
 * Slippage enforcement is via `AllowedSlippage.minAmountOut` on
 * Settler.execute — Settler verifies the final output before transferring
 * to the recipient. Per-action min-out is left at 0 to avoid double-checks.
 */

import { encodeAbiParameters, encodeFunctionData, encodePacked, getAddress } from 'viem'
import type { Address, Hex } from 'viem'
import { ALLOWANCE_HOLDER_ABI, SETTLER_EXECUTE_ABI, WETH_ABI } from './abi'
import { AequiError, ErrorCode } from './errors'
import type {
  ExecutorBackend,
  ExecutorBackendResult,
  SwapPlan,
} from './executor-backend'
import {
  ALLOWANCE_HOLDER_ADDRESS as DEFAULT_ALLOWANCE_HOLDER,
  SETTLER_ACTION_SELECTORS,
  SETTLER_BPS_FULL,
  SETTLER_ETH_ADDRESS,
  type SettlerAction,
} from './settler-types'
import type { TokenMetadata } from './types'

const ZERO_BYTES32: Hex = `0x${'00'.repeat(32)}` as Hex
const ZID_AEQUI: Hex = ZERO_BYTES32 // No zid/affiliate tracking yet.

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

/** Packs UniswapV2 `swapInfo` field used by Settler's UNISWAPV2 action. */
const encodeUniV2SwapInfo = (zeroForOne: boolean, poolFeeBps: number): number => {
  // Settler's UNISWAPV2 swapInfo is uint24:
  //   bits 0..15  = pool fee in basis points (default V2 = 30)
  //   bit  16     = zeroForOne flag
  // Verified against src/core/UniswapV2.sol in the vendored Settler.
  if (poolFeeBps < 0 || poolFeeBps > 0xffff) {
    throw new AequiError('Invalid V2 pool fee', ErrorCode.INVALID_REQUEST, {
      metadata: { poolFeeBps },
    })
  }
  return (zeroForOne ? 1 << 16 : 0) | (poolFeeBps & 0xffff)
}

const encodeV3PackedPath = (tokens: Address[], fees: number[]): Hex => {
  if (tokens.length < 2) {
    throw new AequiError('V3 path requires ≥2 tokens', ErrorCode.INVALID_REQUEST)
  }
  if (fees.length !== tokens.length - 1) {
    throw new AequiError(
      'V3 path fee count must equal token count minus one',
      ErrorCode.INVALID_REQUEST,
      { metadata: { tokens: tokens.length, fees: fees.length } }
    )
  }
  // Use viem's encodePacked: each token is bytes20, each fee is uint24 (3 bytes).
  // The interleaved encoding produces `tok0|fee0|tok1|fee1|...|tokN`.
  const types: string[] = []
  const values: unknown[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    types.push('address')
    values.push(tokens[i])
    if (i < fees.length) {
      types.push('uint24')
      values.push(fees[i])
    }
  }
  return encodePacked(types as never, values as never)
}

interface PoolResolveContext {
  /** The DEX entry from chain config for this hop. */
  readonly dexId: string
  /** Hop input token. */
  readonly tokenIn: Address
  /** Hop output token. */
  readonly tokenOut: Address
  /** Pool address chosen by the planner (when known). */
  readonly poolAddress: Address | undefined
  /** Fee tier (V3 only). */
  readonly feeTier: number | undefined
}

/**
 * SettlerBackend — sole `ExecutorBackend` implementation right now.
 *
 * Construction pattern lets the server wire in fee defaults at startup and
 * keeps per-request `build()` pure.
 */
export class SettlerBackend implements ExecutorBackend {
  constructor(private readonly defaults: { interhopBufferBps: number } = { interhopBufferBps: 0 }) {}

  build(plan: SwapPlan): ExecutorBackendResult {
    this.assertSupported(plan)

    const settlerAddress = this.resolveSettlerAddress(plan)
    const allowanceHolderAddress = plan.chain.settler?.allowanceHolder ?? DEFAULT_ALLOWANCE_HOLDER

    const inputToken = plan.quote.path[0]
    const outputToken = plan.quote.path[plan.quote.path.length - 1]
    if (!inputToken || !outputToken) {
      throw new AequiError(
        'Quote is missing token metadata',
        ErrorCode.INVALID_REQUEST
      )
    }

    const actions: SettlerAction[] = []
    const wrappedNative = plan.chain.wrappedNativeAddress

    if (plan.useNativeInput) {
      if (!wrappedNative) {
        throw new AequiError(
          `Wrapped native not configured for ${plan.chain.name}`,
          ErrorCode.INVALID_CHAIN
        )
      }
      actions.push(this.encodeWrap(wrappedNative, plan.quote.amountIn))
    }

    for (let i = 0; i < plan.quote.sources.length; i += 1) {
      actions.push(this.encodeHopAction(plan, i, settlerAddress))
    }

    if (plan.useNativeOutput) {
      if (!wrappedNative) {
        throw new AequiError(
          `Wrapped native not configured for ${plan.chain.name}`,
          ErrorCode.INVALID_CHAIN
        )
      }
      actions.push(this.encodeUnwrap(wrappedNative))
    }

    if (plan.fee && plan.fee.bps > 0) {
      const expectedAfterFee = (plan.quote.amountOut * BigInt(10_000 - plan.fee.bps)) / 10_000n
      const buyToken = this.settleBuyToken(plan, outputToken)
      actions.push(
        this.encodePositiveSlippage(
          plan.fee.recipient,
          buyToken,
          expectedAfterFee,
          plan.amountOutMin
        )
      )
    }

    const slippage = {
      recipient: plan.recipient,
      buyToken: this.settleBuyToken(plan, outputToken),
      minAmountOut: plan.amountOutMin,
    } as const

    const innerCalldata = encodeFunctionData({
      abi: SETTLER_EXECUTE_ABI,
      functionName: 'execute',
      args: [slippage, actions.map((a) => this.concatActionCalldata(a)), ZID_AEQUI],
    })

    if (plan.tokenFlow !== 'allowance-holder') {
      // TODO_PERMIT2 — wrap `innerCalldata` differently and surface EIP-712
      // payload to the caller. Until then, hard-fail rather than silently
      // building the wrong calldata.
      throw new AequiError(
        'Permit2 token-flow not yet implemented in SettlerBackend',
        ErrorCode.NOT_IMPLEMENTED
      )
    }

    const ahCalldata = encodeFunctionData({
      abi: ALLOWANCE_HOLDER_ABI,
      functionName: 'exec',
      args: [
        settlerAddress, // operator
        plan.useNativeInput ? ZERO_ADDRESS : getAddress(inputToken.address),
        plan.useNativeInput ? 0n : plan.quote.amountIn,
        settlerAddress, // target
        innerCalldata,
      ],
    })

    return {
      kind: 'settler-allowance-holder',
      to: allowanceHolderAddress,
      data: ahCalldata,
      value: plan.useNativeInput ? plan.quote.amountIn : 0n,
      settler: settlerAddress,
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private assertSupported(plan: SwapPlan): void {
    if (plan.quote.isSplit) {
      // TODO_SPLITS — split routes will dispatch one outer Settler action
      // per leg with bps-distributed inputs. Not implemented yet.
      throw new AequiError(
        'Split routes are not yet supported by SettlerBackend',
        ErrorCode.NOT_IMPLEMENTED
      )
    }

    for (const v of plan.quote.hopVersions) {
      if (v !== 'v2' && v !== 'v3') {
        throw new AequiError(
          `Hop version '${v}' is not supported by SettlerBackend yet`,
          ErrorCode.NOT_IMPLEMENTED,
          { metadata: { hopVersion: v } }
        )
      }
    }
  }

  private resolveSettlerAddress(plan: SwapPlan): Address {
    const addr = plan.chain.settler?.settler
    if (!addr || addr === ZERO_ADDRESS) {
      throw new AequiError(
        `Settler address not configured for chain ${plan.chain.name}`,
        ErrorCode.INVALID_CHAIN,
        { metadata: { chain: plan.chain.key } }
      )
    }
    return addr
  }

  private settleBuyToken(
    plan: SwapPlan,
    outputToken: TokenMetadata
  ): Address {
    if (plan.useNativeOutput) {
      return SETTLER_ETH_ADDRESS
    }
    return getAddress(outputToken.address)
  }

  private encodeHopAction(
    plan: SwapPlan,
    hopIndex: number,
    settlerAddress: Address
  ): SettlerAction {
    const source = plan.quote.sources[hopIndex]
    const tokenIn = plan.quote.path[hopIndex] as TokenMetadata | undefined
    const tokenOut = plan.quote.path[hopIndex + 1] as TokenMetadata | undefined
    const hopVersion = plan.quote.hopVersions[hopIndex]
    if (!source || !tokenIn || !tokenOut || !hopVersion) {
      throw new AequiError(
        `Missing route metadata for hop ${hopIndex}`,
        ErrorCode.INVALID_REQUEST,
        { metadata: { hopIndex } }
      )
    }

    const isLastHop = hopIndex === plan.quote.sources.length - 1
    // Settler's slippage check is at `Settler.execute(...)` granularity, so
    // intermediate hops do not need per-hop minimums. We set the final hop's
    // recipient to `settler` (not the user) — the user gets paid by
    // `_checkSlippageAndTransfer` only after fee skim runs.
    const hopRecipient = settlerAddress
    const hopMinOut = isLastHop && !plan.fee ? plan.amountOutMin : 0n

    const ctx: PoolResolveContext = {
      dexId: source.dexId,
      tokenIn: getAddress(tokenIn.address),
      tokenOut: getAddress(tokenOut.address),
      poolAddress: source.poolAddress
        ? getAddress(source.poolAddress)
        : undefined,
      feeTier: source.feeTier,
    }

    if (hopVersion === 'v2') {
      return this.encodeV2HopAction(plan, ctx, hopRecipient, hopMinOut)
    }
    return this.encodeV3HopAction(plan, ctx, hopRecipient, hopMinOut)
  }

  private encodeV2HopAction(
    plan: SwapPlan,
    ctx: PoolResolveContext,
    recipient: Address,
    amountOutMin: bigint
  ): SettlerAction {
    if (!ctx.poolAddress) {
      throw new AequiError(
        `V2 hop requires a pool address (dex=${ctx.dexId})`,
        ErrorCode.INVALID_REQUEST
      )
    }
    // Detect token ordering: pool.token0/token1 ordering is alphabetical by
    // address. zeroForOne is true when tokenIn is token0.
    const zeroForOne = ctx.tokenIn.toLowerCase() < ctx.tokenOut.toLowerCase()
    const dex = plan.chain.dexes.find((d) => d.id === ctx.dexId)
    const poolFeeBps = this.resolveV2PoolFeeBps(dex?.id)
    const swapInfo = encodeUniV2SwapInfo(zeroForOne, poolFeeBps)

    const data = encodeAbiParameters(
      [
        { type: 'address' }, // recipient
        { type: 'address' }, // sellToken
        { type: 'uint256' }, // bps
        { type: 'address' }, // pool
        { type: 'uint24' }, // swapInfo
        { type: 'uint256' }, // amountOutMin
      ],
      [recipient, ctx.tokenIn, SETTLER_BPS_FULL, ctx.poolAddress, swapInfo, amountOutMin]
    )

    return {
      selector: SETTLER_ACTION_SELECTORS.UNISWAPV2,
      data,
      label: `v2-hop-${ctx.dexId}`,
    }
  }

  private encodeV3HopAction(
    plan: SwapPlan,
    ctx: PoolResolveContext,
    recipient: Address,
    amountOutMin: bigint
  ): SettlerAction {
    if (typeof ctx.feeTier !== 'number') {
      throw new AequiError(
        `V3 hop requires a fee tier (dex=${ctx.dexId})`,
        ErrorCode.INVALID_REQUEST
      )
    }
    const path = encodeV3PackedPath([ctx.tokenIn, ctx.tokenOut], [ctx.feeTier])
    const data = encodeAbiParameters(
      [
        { type: 'address' }, // recipient
        { type: 'uint256' }, // bps
        { type: 'bytes' }, // path
        { type: 'uint256' }, // amountOutMin
      ],
      [recipient, SETTLER_BPS_FULL, path, amountOutMin]
    )
    return {
      selector: SETTLER_ACTION_SELECTORS.UNISWAPV3,
      data,
      label: `v3-hop-${ctx.dexId}`,
    }
  }

  private encodeWrap(weth: Address, amount: bigint): SettlerAction {
    // BASIC(sellToken=ETH, bps, pool=weth, offset, data) — calls WETH.deposit{value: amount}().
    // Settler interprets sellToken=ETH + bps as "use msg.value * bps/10000".
    const wethDeposit = encodeFunctionData({
      abi: WETH_ABI,
      functionName: 'deposit',
      args: [],
    })
    const data = encodeAbiParameters(
      [
        { type: 'address' }, // sellToken
        { type: 'uint256' }, // bps
        { type: 'address' }, // pool
        { type: 'uint256' }, // offset (0 = no inject)
        { type: 'bytes' }, // data
      ],
      [SETTLER_ETH_ADDRESS, SETTLER_BPS_FULL, weth, 0n, wethDeposit]
    )
    void amount // value carried via msg.value at AllowanceHolder.exec level
    return {
      selector: SETTLER_ACTION_SELECTORS.BASIC,
      data,
      label: 'wrap-eth',
    }
  }

  private encodeUnwrap(weth: Address): SettlerAction {
    // BASIC(sellToken=weth, bps=full, pool=weth, offset=4, data=withdraw(0))
    // Offset 4 tells Settler to overwrite the uint256 arg at bytes 4..36
    // of `data` with the WETH balance held by Settler — this is the
    // "inject balance into call argument" mechanism.
    const wethWithdraw = encodeFunctionData({
      abi: WETH_ABI,
      functionName: 'withdraw',
      args: [0n],
    })
    const data = encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes' },
      ],
      [weth, SETTLER_BPS_FULL, weth, 4n, wethWithdraw]
    )
    return {
      selector: SETTLER_ACTION_SELECTORS.BASIC,
      data,
      label: 'unwrap-eth',
    }
  }

  private encodePositiveSlippage(
    feeRecipient: Address,
    buyToken: Address,
    expectedAmount: bigint,
    minAmountOut: bigint
  ): SettlerAction {
    const data = encodeAbiParameters(
      [
        { type: 'address' }, // recipient
        { type: 'address' }, // sellToken
        { type: 'uint256' }, // expectedAmount
        { type: 'uint256' }, // amountOutMin
      ],
      [feeRecipient, buyToken, expectedAmount, minAmountOut]
    )
    return {
      selector: SETTLER_ACTION_SELECTORS.POSITIVE_SLIPPAGE,
      data,
      label: 'fee-skim',
    }
  }

  /**
   * Each Settler action is a `bytes` value whose first 4 bytes are the
   * selector and remaining bytes are the abi-encoded args. This matches the
   * dispatch logic in SettlerBase._dispatch which slices `action[0:4]`.
   */
  private concatActionCalldata(action: SettlerAction): Hex {
    return (action.selector + action.data.slice(2)) as Hex
  }

  /**
   * Default V2 pool fee (basis points). Uniswap V2 = 30 bps. PancakeSwap V2
   * = 25 bps. Sushi V2 = 30 bps. The fee feeds into Settler's V2 math, which
   * computes the constant-product output net of the fee.
   *
   * Currently driven off `dexId` — extend with a registry lookup once
   * additional V2 forks are added.
   */
  private resolveV2PoolFeeBps(dexId: string | undefined): number {
    if (!dexId) return 30
    if (dexId === 'pancake-v2') return 25
    return 30
  }
}

