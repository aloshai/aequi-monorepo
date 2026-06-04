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
import {
  ALLOWANCE_HOLDER_ABI,
  SETTLER_EXECUTE_ABI,
  SETTLER_META_TXN_ABI,
  WETH_ABI,
} from './abi'
import { AequiError, ErrorCode } from './errors'
import type {
  ExecutorBackend,
  ExecutorBackendResult,
  Permit2TypedData,
  SwapPlan,
} from './executor-backend'
import {
  ALLOWANCE_HOLDER_ADDRESS as DEFAULT_ALLOWANCE_HOLDER,
  PERMIT2_ADDRESS as DEFAULT_PERMIT2,
  SETTLER_ACTION_SELECTORS,
  SETTLER_BPS_FULL,
  SETTLER_ETH_ADDRESS,
  type SettlerAction,
} from './settler-types'
import type { PriceQuote, TokenMetadata } from './types'

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

/**
 * Settler V3 path layout (per src/core/UniswapV3Fork.sol):
 *   sizeof(address inputToken | uint8 forkId | uint24 poolId | uint160 sqrtPriceLimitX96 | address outputToken)
 *   = 20 + 1 + 3 + 20 + 20 = 64 bytes per hop.
 *
 * This differs from the standard Uniswap V3 path (which is 43 bytes per hop —
 * `address-uint24-address`). Settler's enhanced path adds `forkId` (which V3
 * fork the pool belongs to) and `sqrtPriceLimitX96` (per-hop price guard, 0
 * = no limit).
 *
 * For multi-hop: each subsequent hop repeats the `forkId | poolId | sqrtLimit | outputToken`
 * tail. The shared `outputToken` of hop N is the `inputToken` of hop N+1, so
 * the wire format is `in0 | f0 | p0 | s0 | in1 | f1 | p1 | s1 | ... | inN | fN | pN | sN | outN`.
 */
const encodeV3PackedPath = (
  tokens: Address[],
  fees: number[],
  forkIds: number[]
): Hex => {
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
  if (forkIds.length !== fees.length) {
    throw new AequiError(
      'V3 path forkId count must equal fee count',
      ErrorCode.INVALID_REQUEST,
      { metadata: { fees: fees.length, forkIds: forkIds.length } }
    )
  }
  const types: string[] = []
  const values: unknown[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    types.push('address')
    values.push(tokens[i])
    if (i < fees.length) {
      types.push('uint8')        // forkId
      values.push(forkIds[i])
      types.push('uint24')       // poolId (a.k.a. fee tier / tickSpacing)
      values.push(fees[i])
      // sqrtPriceLimitX96: Settler passes this VERBATIM to pool.swap (no
      // 0→bound substitution — see core/UniswapV3Fork.sol). A value of 0 makes
      // the pool revert 'SPL'. We must supply the direction-appropriate bound:
      //   zeroForOne (selling token0, i.e. tokenIn < tokenOut) → MIN_SQRT+1
      //   oneForZero (selling token1)                          → MAX_SQRT-1
      const tokenIn = (tokens[i] as Address).toLowerCase()
      const tokenOut = (tokens[i + 1] as Address).toLowerCase()
      const zeroForOne = tokenIn < tokenOut
      types.push('uint160')      // sqrtPriceLimitX96
      values.push(zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE)
    }
  }
  return encodePacked(types as never, values as never)
}

/**
 * Map Aequi DEX id to Settler V3 forkId. Lifted from
 * lib/0x-settler/src/core/univ3forks/*.sol. Unknown DEX ids throw, since
 * dispatching to an unrecognised fork would silently route to the wrong
 * factory on chain.
 */
const dexIdToSettlerForkId = (dexId: string): number => {
  switch (dexId) {
    case 'uniswap-v3':
      return 0
    case 'pancake-v3':
      return 1
    case 'sushiswap-v3':
      return 2
    case 'velodrome-slipstream':
      // Velodrome Slipstream uses forkId 4 in Settler's univ3forks dispatch
      // (per core/univ3forks/VelodromeSlipstream.sol). Reuses the standard
      // UNISWAPV3 action with an EIP-1167 minimal proxy pool address
      // derivation. Aequi only routes through this on Ink for now (where
      // our forked Settler wires forkId 4 → Ink Velodrome factory).
      return 4
    default:
      throw new AequiError(
        `No Settler V3 forkId mapping for dex='${dexId}'`,
        ErrorCode.NOT_IMPLEMENTED,
        { metadata: { dexId } }
      )
  }
}

// ─── Uniswap V4 helpers ───────────────────────────────────────────────────────

/**
 * MAX_TOKENS from FlashAccountingCommon.sol — the size of Settler's
 * per-swap notes table. The perfect hash must distribute fillen tokens
 * into distinct slots in [0, MAX_TOKENS).
 */
const SETTLER_V4_MAX_TOKENS = 8

/** sqrtPriceX96 bounds, identical to Uniswap V3/V4. */
const MIN_SQRT_PRICE_PLUS_ONE = 4295128740n
const MAX_SQRT_PRICE_MINUS_ONE =
  1461446703485210103287273052203988822378723970341n

const toBigIntAddress = (addr: Address): bigint => BigInt(addr)

/**
 * Find the smallest (hashMul, hashMod) pair such that two distinct tokens
 * land in different slots of Settler's MAX_TOKENS-sized notes table. Mirrors
 * the Solidity loop in lib/0x-settler/test/integration/UniswapV4PairTest.t.sol
 * (`uniswapV4PerfectHash`).
 *
 * For two tokens this terminates quickly (typically within a few iterations).
 * Token order matters only in that hashMod must produce distinct slots — the
 * returned values are valid for either swap direction across the same pair.
 */
const findV4PerfectHash = (token0: Address, token1: Address): { hashMul: bigint; hashMod: bigint } => {
  const a = toBigIntAddress(token0)
  const b = toBigIntAddress(token1)
  const max = BigInt(SETTLER_V4_MAX_TOKENS)
  for (let hashMod = max + 1n; hashMod < max + 256n; hashMod += 1n) {
    const start = hashMod / 2n
    const end = hashMod + hashMod / 2n
    for (let hashMul = start; hashMul < end; hashMul += 1n) {
      const slotA = ((a * hashMul) % hashMod) % max
      const slotB = ((b * hashMul) % hashMod) % max
      if (slotA !== slotB) {
        return { hashMul, hashMod }
      }
    }
  }
  // Practically unreachable for two distinct addresses.
  throw new AequiError(
    'Could not find Settler V4 perfect hash for token pair',
    ErrorCode.INTERNAL_ERROR,
    { metadata: { token0, token1 } }
  )
}

/** Big-endian byte encoder for n-byte unsigned ints into a Uint8Array. */
const writeUint = (out: number[], value: bigint, byteLen: number): void => {
  for (let i = byteLen - 1; i >= 0; i -= 1) {
    out.push(Number((value >> (BigInt(i) * 8n)) & 0xffn))
  }
}

const writeAddress = (out: number[], addr: Address): void => {
  writeUint(out, toBigIntAddress(addr), 20)
}

const bytesToHex = (bytes: number[]): Hex => {
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}` as Hex
}

/**
 * Encode a single hookless V4 fill (no multi-pool batching, no hook data).
 * Layout per Settler's V4 `fills` documentation:
 *   uint16 bps | uint160 sqrtPriceLimitX96 | uint8 packingKey | (0|1|2)*address tokens
 *   | uint24 fee | uint24 tickSpacing | address hooks | uint24 hookDataLen | bytes hookData
 *
 * Packing key = 1 means: sell token unchanged from previous fill (which for
 * the first fill is the action's `sellToken` argument), encode buy token.
 * Total length for a hookless single-hop fill: 2 + 20 + 1 + 20 + 3 + 3 + 20 + 3 = 72 bytes.
 */
const encodeV4SingleHopFill = (args: {
  bps: number
  buyToken: Address
  zeroForOne: boolean
  fee: number
  tickSpacing: number
}): Hex => {
  const bytes: number[] = []
  writeUint(bytes, BigInt(args.bps), 2)
  writeUint(
    bytes,
    args.zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE,
    20
  )
  bytes.push(0x01) // packing key: encode only buy token
  writeAddress(bytes, args.buyToken)
  writeUint(bytes, BigInt(args.fee), 3)
  writeUint(bytes, BigInt(args.tickSpacing), 3)
  writeAddress(bytes, '0x0000000000000000000000000000000000000000') // hooks = 0
  writeUint(bytes, 0n, 3) // hookDataLen = 0
  return bytesToHex(bytes)
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
  /** Fee tier (V3 / V4 only). */
  readonly feeTier: number | undefined
  /** Tick spacing (V4 only; V3 forks derive it from fee tier). */
  readonly tickSpacing: number | undefined
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

    if (plan.quote.isSplit) {
      const splits = plan.quote.splits!
      let consumedBps = 0
      for (let legIdx = 0; legIdx < splits.length; legIdx += 1) {
        const leg = splits[legIdx]!
        const remainingBps = 10_000 - consumedBps
        // The first hop of each leg consumes a percentage of the current
        // Settler balance of the input token. Subsequent hops within the
        // leg consume 100% of the previous hop's output.
        const firstHopBps =
          legIdx === splits.length - 1 || remainingBps === 0
            ? 10_000
            : Math.floor((leg.ratioBps * 10_000) / remainingBps)
        consumedBps += leg.ratioBps

        for (let hopIdx = 0; hopIdx < leg.quote.sources.length; hopIdx += 1) {
          const bps = hopIdx === 0 ? firstHopBps : 10_000
          actions.push(this.encodeSplitHopAction(plan, leg, hopIdx, settlerAddress, bps))
        }
      }
    } else {
      for (let i = 0; i < plan.quote.sources.length; i += 1) {
        actions.push(this.encodeHopAction(plan, i, settlerAddress))
      }
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

    // Permit2 mode builds its own action list (prepends METATXN_TRANSFER_FROM)
    // and entrypoint; hand off the swap actions before AllowanceHolder framing.
    if (plan.tokenFlow === 'permit2') {
      return this.buildPermit2(plan, actions, inputToken, outputToken, settlerAddress)
    }

    const slippage = {
      recipient: plan.recipient,
      buyToken: this.settleBuyToken(plan, outputToken),
      minAmountOut: plan.amountOutMin,
    } as const

    // AllowanceHolder mode: for ERC20 input we MUST move the tokens into
    // Settler first, because the swap actions sell `bps × Settler.balanceOf`.
    // Without this the balance is 0 → the pool gets amountSpecified 0 → the
    // pool reverts ('AS' on UniV3/Slipstream forks). Native input is funded
    // by the WRAP action instead, so it needs no TRANSFER_FROM.
    const ahActions: SettlerAction[] = plan.useNativeInput
      ? actions
      : [
          this.encodeTransferFrom(settlerAddress, getAddress(inputToken.address), plan.quote.amountIn),
          ...actions,
        ]

    const innerCalldata = encodeFunctionData({
      abi: SETTLER_EXECUTE_ABI,
      functionName: 'execute',
      args: [slippage, ahActions.map((a) => this.concatActionCalldata(a)), ZID_AEQUI],
    })

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

  /**
   * TRANSFER_FROM action for AllowanceHolder mode — moves `amount` of `token`
   * from the taker into Settler (`recipient`). `sig` is empty: in
   * taker-submitted mode Settler routes this through the AllowanceHolder
   * allowance rather than a Permit2 signature. nonce/deadline are unused on
   * the AllowanceHolder path but must be present for ABI shape.
   */
  private encodeTransferFrom(recipient: Address, token: Address, amount: bigint): SettlerAction {
    const data = encodeAbiParameters(
      [
        { type: 'address' }, // recipient
        {
          type: 'tuple',
          components: [
            {
              type: 'tuple',
              name: 'permitted',
              components: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint256' },
              ],
            },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        { type: 'bytes' }, // sig (empty for AllowanceHolder)
      ],
      [
        recipient,
        { permitted: { token, amount }, nonce: 0n, deadline: 2n ** 48n } as never,
        '0x',
      ]
    )
    return {
      selector: SETTLER_ACTION_SELECTORS.TRANSFER_FROM,
      data,
      label: 'transfer-from',
    }
  }

  /**
   * Permit2 mode build. Differs from AllowanceHolder in three ways:
   *   1. Target is SettlerMetaTxn (not AllowanceHolder).
   *   2. First action MUST be METATXN_TRANSFER_FROM (consumes the sig and
   *      pulls input tokens via Permit2). Native input is not supported in
   *      this mode — the user would have nothing to sign over.
   *   3. The full call is `executeMetaTxn(slippage, actions, zid, msgSender, sig)`
   *      where `sig` comes from the wallet signing a PermitWitnessTransferFrom
   *      typed data whose witness is SlippageAndActions(recipient, buyToken,
   *      minAmountOut, actions).
   */
  private buildPermit2(
    plan: SwapPlan,
    swapActions: SettlerAction[],
    inputToken: TokenMetadata,
    outputToken: TokenMetadata,
    settlerAddress: Address
  ): ExecutorBackendResult {
    if (plan.useNativeInput) {
      throw new AequiError(
        'Permit2 mode does not support native input. Use settler-allowance-holder for ETH/BNB swaps.',
        ErrorCode.INVALID_REQUEST
      )
    }

    const settlerMetaTxn = plan.chain.settler?.settlerMetaTxn
    if (!settlerMetaTxn || settlerMetaTxn === ZERO_ADDRESS) {
      throw new AequiError(
        `SettlerMetaTxn address not configured for chain ${plan.chain.name}`,
        ErrorCode.INVALID_CHAIN,
        { metadata: { chain: plan.chain.key } }
      )
    }

    const permit2 = plan.chain.settler?.permit2 ?? DEFAULT_PERMIT2
    const tokenAddr = getAddress(inputToken.address)
    const recipient = plan.recipient

    // Per-message Permit2 nonce. Permit2 stores used nonces per (owner, word)
    // so any unique uint256 works. We derive one from time + entropy to avoid
    // collisions when the same user signs multiple in-flight swaps.
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000))
    const nonce = (nowSeconds << 64n) | (BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) & ((1n << 64n) - 1n))
    const deadline = nowSeconds + BigInt(Math.max(plan.deadlineSeconds, 60))

    // First action: METATXN_TRANSFER_FROM(recipient=settler, PermitTransferFrom).
    // recipient here is the *intermediate* — Settler holds the tokens to feed
    // the subsequent swap actions. Final settlement is via slippage.recipient.
    const permitTransferAction = this.encodeMetaTxnTransferFrom(
      settlerAddress,
      tokenAddr,
      plan.quote.amountIn,
      nonce,
      deadline
    )

    const actionsBytes: Hex[] = [
      this.concatActionCalldata(permitTransferAction),
      ...swapActions.map((a) => this.concatActionCalldata(a)),
    ]

    const slippage = {
      recipient,
      buyToken: this.settleBuyToken(plan, outputToken),
      minAmountOut: plan.amountOutMin,
    } as const

    // Calldata with sig=0x placeholder. The frontend re-encodes with the
    // actual signature filled in (we pass `permit2.{slippage,actions,...}`
    // so the frontend doesn't need to recompute anything).
    const calldataPlaceholder = encodeFunctionData({
      abi: SETTLER_META_TXN_ABI,
      functionName: 'executeMetaTxn',
      args: [slippage, actionsBytes, ZID_AEQUI, recipient, '0x'],
    })

    const typedData = this.buildPermit2TypedData({
      chainId: plan.chain.id,
      permit2Address: permit2,
      token: tokenAddr,
      amount: plan.quote.amountIn,
      spender: settlerMetaTxn,
      nonce,
      deadline,
      slippage,
      actionsBytes,
    })

    return {
      kind: 'settler-permit2',
      to: settlerMetaTxn,
      data: calldataPlaceholder,
      value: 0n, // Permit2 mode is ERC20-only
      settler: settlerMetaTxn,
      permit2: {
        typedData,
        slippage,
        actions: actionsBytes,
        msgSender: recipient,
        zid: ZID_AEQUI,
      },
    }
  }

  private encodeMetaTxnTransferFrom(
    recipient: Address,
    token: Address,
    amount: bigint,
    nonce: bigint,
    deadline: bigint
  ): SettlerAction {
    // METATXN_TRANSFER_FROM(address recipient, ISignatureTransfer.PermitTransferFrom permit)
    // PermitTransferFrom struct:
    //   TokenPermissions permitted { token, amount }
    //   uint256 nonce
    //   uint256 deadline
    const data = encodeAbiParameters(
      [
        { type: 'address' }, // recipient
        {
          type: 'tuple',
          components: [
            {
              type: 'tuple',
              name: 'permitted',
              components: [
                { name: 'token', type: 'address' },
                { name: 'amount', type: 'uint256' },
              ],
            },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
      ],
      [
        recipient,
        {
          permitted: { token, amount },
          nonce,
          deadline,
        } as never,
      ]
    )
    return {
      selector: SETTLER_ACTION_SELECTORS.METATXN_TRANSFER_FROM,
      data,
      label: 'metatxn-transfer-from',
    }
  }

  private buildPermit2TypedData(args: {
    chainId: number
    permit2Address: Address
    token: Address
    amount: bigint
    spender: Address
    nonce: bigint
    deadline: bigint
    slippage: { recipient: Address; buyToken: Address; minAmountOut: bigint }
    actionsBytes: Hex[]
  }): Permit2TypedData {
    return {
      domain: {
        name: 'Permit2',
        chainId: args.chainId,
        verifyingContract: args.permit2Address,
      },
      // viem signTypedData accepts a `types` map. The order of nested types
      // doesn't matter; viem hashes per EIP-712 spec.
      types: {
        PermitWitnessTransferFrom: [
          { name: 'permitted', type: 'TokenPermissions' },
          { name: 'spender', type: 'address' },
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'witness', type: 'SlippageAndActions' },
        ],
        TokenPermissions: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        // Witness type MUST match Settler's SLIPPAGE_AND_ACTIONS_TYPE exactly:
        //   "SlippageAndActions(address recipient,address buyToken,uint256 minAmountOut,bytes[] actions)"
        SlippageAndActions: [
          { name: 'recipient', type: 'address' },
          { name: 'buyToken', type: 'address' },
          { name: 'minAmountOut', type: 'uint256' },
          { name: 'actions', type: 'bytes[]' },
        ],
      },
      primaryType: 'PermitWitnessTransferFrom',
      message: {
        permitted: { token: args.token, amount: args.amount },
        spender: args.spender,
        nonce: args.nonce,
        deadline: args.deadline,
        witness: {
          recipient: args.slippage.recipient,
          buyToken: args.slippage.buyToken,
          minAmountOut: args.slippage.minAmountOut,
          actions: args.actionsBytes,
        },
      },
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private assertSupported(plan: SwapPlan): void {
    if (plan.quote.isSplit) {
      if (!plan.quote.splits || plan.quote.splits.length === 0) {
        throw new AequiError(
          'isSplit set but no splits provided',
          ErrorCode.INVALID_REQUEST
        )
      }
      const totalRatio = plan.quote.splits.reduce((acc, leg) => acc + leg.ratioBps, 0)
      if (totalRatio !== 10_000) {
        throw new AequiError(
          `Split leg ratios must sum to 10000 (got ${totalRatio})`,
          ErrorCode.INVALID_REQUEST,
          { metadata: { totalRatio } }
        )
      }
      // Splits are handled by the dedicated split path below; do not check
      // top-level hopVersions (each leg has its own).
      return
    }

    for (const v of plan.quote.hopVersions) {
      if (v !== 'v2' && v !== 'v3' && v !== 'v4') {
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
      tickSpacing: source.tickSpacing,
    }

    if (hopVersion === 'v2') {
      return this.encodeV2HopAction(plan, ctx, hopRecipient, hopMinOut, SETTLER_BPS_FULL)
    }
    if (hopVersion === 'v4') {
      return this.encodeV4HopAction(ctx, hopRecipient, hopMinOut, 10_000)
    }
    return this.encodeV3HopAction(ctx, hopRecipient, hopMinOut, SETTLER_BPS_FULL)
  }

  private encodeSplitHopAction(
    plan: SwapPlan,
    leg: { quote: PriceQuote; ratioBps: number },
    hopIndex: number,
    settlerAddress: Address,
    bps: number
  ): SettlerAction {
    const source = leg.quote.sources[hopIndex]
    const tokenIn = leg.quote.path[hopIndex] as TokenMetadata | undefined
    const tokenOut = leg.quote.path[hopIndex + 1] as TokenMetadata | undefined
    const hopVersion = leg.quote.hopVersions[hopIndex]
    if (!source || !tokenIn || !tokenOut || !hopVersion) {
      throw new AequiError(
        `Missing split-leg route metadata at hop ${hopIndex}`,
        ErrorCode.INVALID_REQUEST,
        { metadata: { hopIndex, legRatio: leg.ratioBps } }
      )
    }
    if (hopVersion !== 'v2' && hopVersion !== 'v3' && hopVersion !== 'v4') {
      throw new AequiError(
        `Hop version '${hopVersion}' is not supported by SettlerBackend yet`,
        ErrorCode.NOT_IMPLEMENTED,
        { metadata: { hopVersion } }
      )
    }
    const ctx: PoolResolveContext = {
      dexId: source.dexId,
      tokenIn: getAddress(tokenIn.address),
      tokenOut: getAddress(tokenOut.address),
      poolAddress: source.poolAddress ? getAddress(source.poolAddress) : undefined,
      feeTier: source.feeTier,
      tickSpacing: source.tickSpacing,
    }
    // Split leg hops always carry minOut=0; overall protection comes from
    // Settler.execute's AllowedSlippage check on the buyToken after all
    // actions have run.
    const hopMinOut = 0n
    const bpsBig = BigInt(bps)
    if (hopVersion === 'v2') {
      return this.encodeV2HopAction(plan, ctx, settlerAddress, hopMinOut, bpsBig)
    }
    if (hopVersion === 'v4') {
      return this.encodeV4HopAction(ctx, settlerAddress, hopMinOut, Number(bpsBig))
    }
    return this.encodeV3HopAction(ctx, settlerAddress, hopMinOut, bpsBig)
  }

  private encodeV2HopAction(
    plan: SwapPlan,
    ctx: PoolResolveContext,
    recipient: Address,
    amountOutMin: bigint,
    bps: bigint
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
      [recipient, ctx.tokenIn, bps, ctx.poolAddress, swapInfo, amountOutMin]
    )

    return {
      selector: SETTLER_ACTION_SELECTORS.UNISWAPV2,
      data,
      label: `v2-hop-${ctx.dexId}`,
    }
  }

  /**
   * Encode a Uniswap V4 single-hop hookless swap as a UNISWAPV4 Settler action.
   *
   * UNISWAPV4(recipient, sellToken, bps, feeOnTransfer, hashMul, hashMod, fills, amountOutMin)
   *
   * `fills` is the custom per-fill packed format (see encodeV4SingleHopFill).
   * `hashMul`/`hashMod` form a perfect hash distributing (sellToken, buyToken)
   * into distinct slots of Settler's notes table — computed on demand here.
   * `feeOnTransfer` is forced false; FoT tokens require V4 action variants
   * not modelled in this iteration.
   *
   * The hop's `bps` is the percentage of the Settler-held balance to spend on
   * this fill (0..10000).
   */
  private encodeV4HopAction(
    ctx: PoolResolveContext,
    recipient: Address,
    amountOutMin: bigint,
    bps: number
  ): SettlerAction {
    if (typeof ctx.feeTier !== 'number') {
      throw new AequiError(
        `V4 hop requires a fee tier (dex=${ctx.dexId})`,
        ErrorCode.INVALID_REQUEST
      )
    }
    if (typeof ctx.tickSpacing !== 'number') {
      throw new AequiError(
        `V4 hop requires a tick spacing (dex=${ctx.dexId})`,
        ErrorCode.INVALID_REQUEST
      )
    }
    const zeroForOne = ctx.tokenIn.toLowerCase() < ctx.tokenOut.toLowerCase()
    const fills = encodeV4SingleHopFill({
      bps,
      buyToken: ctx.tokenOut,
      zeroForOne,
      fee: ctx.feeTier,
      tickSpacing: ctx.tickSpacing,
    })
    const { hashMul, hashMod } = findV4PerfectHash(ctx.tokenIn, ctx.tokenOut)
    const data = encodeAbiParameters(
      [
        { type: 'address' }, // recipient
        { type: 'address' }, // sellToken
        { type: 'uint256' }, // bps (top-level — share of msg.sender balance routed)
        { type: 'bool' }, // feeOnTransfer
        { type: 'uint256' }, // hashMul
        { type: 'uint256' }, // hashMod
        { type: 'bytes' }, // fills
        { type: 'uint256' }, // amountOutMin
      ],
      [
        recipient,
        ctx.tokenIn,
        SETTLER_BPS_FULL,
        false,
        hashMul,
        hashMod,
        fills,
        amountOutMin,
      ]
    )
    return {
      selector: SETTLER_ACTION_SELECTORS.UNISWAPV4,
      data,
      label: `v4-hop-${ctx.dexId}`,
    }
  }

  private encodeV3HopAction(
    ctx: PoolResolveContext,
    recipient: Address,
    amountOutMin: bigint,
    bps: bigint
  ): SettlerAction {
    if (typeof ctx.feeTier !== 'number') {
      throw new AequiError(
        `V3 hop requires a fee tier (dex=${ctx.dexId})`,
        ErrorCode.INVALID_REQUEST
      )
    }
    const forkId = dexIdToSettlerForkId(ctx.dexId)
    const path = encodeV3PackedPath([ctx.tokenIn, ctx.tokenOut], [ctx.feeTier], [forkId])
    const data = encodeAbiParameters(
      [
        { type: 'address' }, // recipient
        { type: 'uint256' }, // bps
        { type: 'bytes' }, // path
        { type: 'uint256' }, // amountOutMin
      ],
      [recipient, bps, path, amountOutMin]
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

