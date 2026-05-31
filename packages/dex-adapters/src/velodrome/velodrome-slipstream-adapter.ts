import type { Abi } from 'viem'
import type { PriceQuote } from '@aequi/core'
import { BaseDexAdapter, type V3QuoteParams } from '@aequi/pricing'

/**
 * Velodrome Slipstream quoter ABI. Same shape as Uniswap V3 QuoterV2 EXCEPT
 * the pool key uses `tickSpacing` (int24) where standard V3 uses `fee` (uint24).
 * This is THE structural difference between Slipstream and vanilla V3.
 */
const SLIPSTREAM_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const satisfies Abi

/**
 * Velodrome Slipstream (CL) adapter. Slipstream = Velodrome's Uniswap V3
 * fork; pools are EIP-1167 minimal proxies created by
 * `Clones.cloneDeterministic` over a singleton pool implementation. Pool
 * lookup is keyed by tickSpacing rather than fee.
 *
 * Aequi treats Slipstream as a `v3`-versioned adapter. Routing is dispatched
 * by `SettlerBackend` via the UNISWAPV3 action with forkId=4 (per Settler's
 * `core/univ3forks/VelodromeSlipstream.sol`). The chain mixin must wire
 * forkId 4 to Velodrome's chain-specific factory + init hash — Aequi's
 * forked Settler does this for Ink.
 *
 * Pricing layer uses Slipstream's own Quoter (tickSpacing-keyed) which is
 * deployed at the same deterministic address on every Superchain L2.
 */
export class VelodromeSlipstreamAdapter extends BaseDexAdapter {
  readonly protocol = 'velodrome-slipstream'
  readonly version = 'v3' as const

  async computeV3Quote(params: V3QuoteParams): Promise<PriceQuote | null> {
    const { chainKey, dex, tokenIn, tokenOut, amountIn, fee, poolAddress, gasPriceWei, client } = params

    if (!dex.quoterAddress) {
      console.warn(`[VelodromeSlipstream] Missing quoter address for DEX ${dex.id}`)
      return null
    }

    // Discovery passes the tickSpacing in the `fee` slot of V3QuoteParams.
    // Slipstream's factory is tickSpacing-keyed; we reuse the V3 plumbing's
    // existing field rather than introducing a parallel parameter type.
    const tickSpacing = fee

    let amountOut: bigint
    try {
      const result = await client.simulateContract({
        address: dex.quoterAddress,
        abi: SLIPSTREAM_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            amountIn,
            tickSpacing,
            sqrtPriceLimitX96: 0n,
          },
        ],
      })
      const [out] = result.result as readonly [bigint, bigint, number, bigint]
      amountOut = out
    } catch {
      // Pool exists but no liquidity at this size — fail the quote silently.
      return null
    }

    if (amountOut <= 0n) return null

    const priceQ18 = (amountOut * 10n ** 18n) / amountIn

    return {
      chain: chainKey as PriceQuote['chain'],
      amountIn,
      amountOut,
      priceQ18,
      executionPriceQ18: priceQ18,
      midPriceQ18: priceQ18,
      // Quoter doesn't return pre-trade mid → leave 0 (consumer treats as
      // unknown; risk score / impact bar can fall back to delta vs midPrice).
      priceImpactBps: 0,
      path: [tokenIn, tokenOut],
      routeAddresses: [tokenIn.address, tokenOut.address],
      sources: [
        {
          dexId: dex.id,
          poolAddress,
          // Stuff tickSpacing into the feeTier slot. SettlerBackend's V3
          // packed path encoder uses this as `poolId`, and for Slipstream
          // Settler interprets `poolId` as tickSpacing thanks to forkId=4
          // routing through Velodrome's pool-address derivation.
          feeTier: tickSpacing,
          amountIn,
          amountOut,
        },
      ],
      liquidityScore: 0n,
      hopVersions: ['v3'],
      estimatedGasUnits: this.estimateGas(['v3']),
      estimatedGasCostWei: gasPriceWei ? gasPriceWei * this.estimateGas(['v3']) : null,
      gasPriceWei,
    }
  }
}
