/**
 * `ExecutorBackend` is the abstraction that turns a planned `SwapPlan` into
 * concrete on-chain calldata. There is currently one implementation,
 * `SettlerBackend`. The interface exists so the orchestration in
 * `SwapBuilder` does not depend on Settler's specifics, leaving room for
 * alternative execution venues (e.g. UniversalRouter) to be added without
 * a builder rewrite.
 *
 * The plan input is intentionally chain- and protocol-agnostic. The
 * backend resolves DEX-specific encoders via the registry in
 * `@aequi/dex-adapters`.
 */

import type { Address, Hex } from 'viem'
import type { ChainConfig, PriceQuote } from './types'

export type TokenFlow = 'allowance-holder' | 'permit2'

/**
 * EIP-712 typed data payload returned by SettlerBackend for Permit2 mode.
 * Frontend feeds this directly into wagmi/viem `signTypedData`.
 */
export interface Permit2TypedData {
  readonly domain: {
    readonly name: string
    readonly chainId: number
    readonly verifyingContract: Address
  }
  readonly types: Record<string, Array<{ name: string; type: string }>>
  readonly primaryType: 'PermitWitnessTransferFrom'
  readonly message: {
    readonly permitted: { token: Address; amount: bigint }
    readonly spender: Address
    readonly nonce: bigint
    readonly deadline: bigint
    readonly witness: {
      recipient: Address
      buyToken: Address
      minAmountOut: bigint
      actions: readonly Hex[]
    }
  }
}

export interface SwapPlan {
  /** The quote produced by `@aequi/pricing`. Carries route + amounts. */
  readonly quote: PriceQuote
  /** Final recipient of the output token (after fee skim). */
  readonly recipient: Address
  /** Minimum amount-out the user will accept. */
  readonly amountOutMin: bigint
  /** Whether the sell-token is native (ETH/BNB) — Settler will wrap. */
  readonly useNativeInput: boolean
  /** Whether the buy-token is native — Settler will unwrap. */
  readonly useNativeOutput: boolean
  /** Token-flow mode chosen by the caller. */
  readonly tokenFlow: TokenFlow
  /** Per-chain Settler addresses (settler, allowanceHolder, permit2). */
  readonly chain: ChainConfig
  /** Fee-collection config; pass `null` to disable fee skim. */
  readonly fee: FeeConfig | null
  /** Deadline (unix seconds). Settler does not enforce; quote TTL does. */
  readonly deadlineSeconds: number
}

export interface FeeConfig {
  readonly bps: number
  readonly recipient: Address
}

export type SwapTransactionKind =
  | 'settler-allowance-holder'
  | 'settler-permit2'
  /** Legacy AequiExecutor — removed once Plan 3 finishes the server cutover. */
  | 'executor'

export interface ExecutorBackendResult {
  readonly kind: SwapTransactionKind
  /** Target contract for the transaction. AllowanceHolder for AH mode, SettlerMetaTxn for Permit2. */
  readonly to: Address
  /**
   * Encoded calldata. For AllowanceHolder mode, this is final. For Permit2
   * mode, this calldata has `sig: 0x` as a placeholder — the frontend must
   * re-encode `executeMetaTxn(...)` with the wallet signature filled in.
   * The metadata needed to do that is provided in `permit2`.
   */
  readonly data: Hex
  /** Native value to attach. Non-zero only when useNativeInput. */
  readonly value: bigint
  /** Echo of the resolved Settler address (for debug / server-side simulation). */
  readonly settler: Address
  /**
   * Permit2 sign + finalize metadata. Present iff `kind === 'settler-permit2'`.
   * Frontend uses this to:
   *   1. Call `signTypedData(permit2.typedData)` to get a wallet signature.
   *   2. Re-encode `executeMetaTxn(slippage, actions, zid, msgSender, sig)`
   *      using the returned `actions`, `slippage`, `msgSender`, `zid`.
   */
  readonly permit2?: {
    readonly typedData: Permit2TypedData
    readonly slippage: { recipient: Address; buyToken: Address; minAmountOut: bigint }
    readonly actions: readonly Hex[]
    readonly msgSender: Address
    readonly zid: Hex
  }
}

export interface ExecutorBackend {
  /** Build a swap transaction. Throws if the plan is not buildable on this backend. */
  build(plan: SwapPlan): ExecutorBackendResult
}
