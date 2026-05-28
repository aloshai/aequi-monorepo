/**
 * Type definitions and constants for 0x Settler integration.
 *
 * Settler is the execution backend that replaces AequiExecutor. It takes an
 * array of "actions" (each a (selector, data) tuple) and executes them
 * atomically. Each action does one thing: a swap on a specific DEX, a token
 * transfer, a slippage check, etc.
 *
 * See: packages/contracts/lib/0x-settler/src/ISettlerActions.sol for the full
 * interface, and the NOTES file in docs/superpowers/plans/ for the subset
 * Aequi uses.
 */

import { toFunctionSelector, type Address, type Hex } from 'viem'

export const SETTLER_BPS_FULL = 10_000n as const

/**
 * Function selectors for the Settler actions Aequi uses. Each one is the
 * first 4 bytes of the keccak256 of the function signature in
 * ISettlerActions.sol.
 *
 * The signatures below MUST stay in sync with ISettlerActions in the
 * vendored Settler submodule. If a Settler upgrade changes any signature,
 * the corresponding test (settler-action-selectors.test.ts) will flag it.
 */
export const SETTLER_ACTION_SELECTORS = {
  /**
   * METATXN_TRANSFER_FROM(recipient, PermitTransferFrom)
   * — VIP action: consumes the Permit2 signature passed to `executeMetaTxn`
   * and pulls `permit.permitted.amount` of `permit.permitted.token` from the
   * msgSender to `recipient`. Used as the first action of a Permit2 sequence.
   */
  METATXN_TRANSFER_FROM: toFunctionSelector(
    'METATXN_TRANSFER_FROM(address,((address,uint256),uint256,uint256))'
  ),

  /**
   * UNISWAPV2(recipient, sellToken, bps, pool, swapInfo, amountOutMin)
   * — V2 swap (and all V2 forks: PancakeSwap V2, Sushiswap V2, etc.).
   * `swapInfo` packs (zeroForOne, feeBps) — see Settler source for exact layout.
   */
  UNISWAPV2: toFunctionSelector(
    'UNISWAPV2(address,address,uint256,address,uint24,uint256)'
  ),

  /**
   * UNISWAPV3(recipient, bps, path, amountOutMin)
   * — V3 swap (and all V3 forks: PancakeSwap V3, Incentive Portal V3, etc.).
   * `path` is the standard Uniswap V3 packed path: token-fee-token-fee-token...
   */
  UNISWAPV3: toFunctionSelector(
    'UNISWAPV3(address,uint256,bytes,uint256)'
  ),

  /**
   * UNISWAPV4(recipient, sellToken, bps, feeOnTransfer, hashMul, hashMod, fills, amountOutMin)
   * — V4 swap. `fills` is a custom packed format:
   *   per-fill: uint16 bps | uint160 sqrtPriceLimitX96 | uint8 packingKey | (0|1|2)*address tokens | uint24 fee | uint24 tickSpacing | address hooks | uint24 hookDataLen | bytes hookData
   * packingKey: 0=both unchanged, 1=new buy token, 2=multihop (prev buy→sell, new buy), 3=both encoded
   * For Aequi's hookless V4 single-hop the encoding is simpler — see settler-backend.ts.
   */
  UNISWAPV4: toFunctionSelector(
    'UNISWAPV4(address,address,uint256,bool,uint256,uint256,bytes,uint256)'
  ),

  /**
   * BASIC(sellToken, bps, pool, offset, data)
   * — Generic external call. Used for arbitrary token transfers and
   * non-swap utility operations (e.g. WETH wrap/unwrap).
   */
  BASIC: toFunctionSelector('BASIC(address,uint256,address,uint256,bytes)'),

  /**
   * POSITIVE_SLIPPAGE(recipient, sellToken, expectedAmount, amountOutMin)
   * — Sends positive slippage above `expectedAmount` to `recipient`,
   * ensures the caller still receives at least `amountOutMin`. Aequi uses
   * this for fee collection: expectedAmount = quote.amountOut * (1 - FEE_BPS/10000),
   * recipient = fee wallet.
   */
  POSITIVE_SLIPPAGE: toFunctionSelector(
    'POSITIVE_SLIPPAGE(address,address,uint256,uint256)'
  ),
} as const

export type SettlerActionSelector =
  (typeof SETTLER_ACTION_SELECTORS)[keyof typeof SETTLER_ACTION_SELECTORS]

/** A single Settler action — (selector, abi-encoded data). */
export interface SettlerAction {
  readonly selector: SettlerActionSelector
  readonly data: Hex
  /** Optional debug label (e.g. "v2-hop-0", "wrap-eth"). Not sent on-chain. */
  readonly label?: string
}

/** AllowedSlippage tuple — Settler's `execute(slippage, actions, zid)` first arg. */
export interface SettlerAllowedSlippage {
  /** Final output recipient (after fee skim if any). */
  readonly recipient: Address
  /** Output token. Use ETH_ADDRESS for native. */
  readonly buyToken: Address
  /** Minimum acceptable output amount. */
  readonly minAmountOut: bigint
}

/** Settler's ETH sentinel for native swaps in AllowedSlippage.buyToken. */
export const SETTLER_ETH_ADDRESS: Address =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/** Canonical Permit2 (identical across all EVM chains). */
export const PERMIT2_ADDRESS: Address =
  '0x000000000022D473030F116dDEE9F6B43aC78BA3'

/** Canonical AllowanceHolder (identical across all EVM chains). */
export const ALLOWANCE_HOLDER_ADDRESS: Address =
  '0x0000000000001fF3684f28c67538d4D072C22734'
