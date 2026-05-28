import type { Abi } from 'viem'
import type { PriceQuote } from '@aequi/core'
import { BaseDexAdapter, type V4QuoteParams } from '@aequi/pricing'

/**
 * Uniswap V4 Quoter ABI (only the function Aequi needs).
 *
 * `quoteExactInputSingle` is `nonpayable` even though it reverts after
 * computing the result — Uniswap intentionally uses revert-with-data to
 * avoid mutating state. Viem's `readContract` handles this transparently
 * for V4Quoter because they ship a state-override path; alternatively the
 * caller can use `simulateContract`.
 */
const V4_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const satisfies Abi

/**
 * Uniswap V4 adapter. Queries the V4Quoter directly for spot prices on a
 * (currency0, currency1, fee, tickSpacing, hooks=0x0) pool key. Only
 * hookless pools are supported in this iteration — hook-bearing pools
 * require running the hook's logic to quote correctly, which is out of
 * scope for the bootstrap adapter.
 */
export class UniswapV4Adapter extends BaseDexAdapter {
  readonly protocol = 'uniswap'
  readonly version = 'v4' as const

  async computeV4Quote(params: V4QuoteParams): Promise<PriceQuote | null> {
    const { chainKey, dex, tokenIn, tokenOut, amountIn, fee, tickSpacing, hooks, gasPriceWei, client } = params

    if (!dex.quoterAddress) {
      console.warn(`[UniswapV4] Missing quoter address for DEX ${dex.id}`)
      return null
    }

    // V4 PoolKey requires sorted currencies (currency0 < currency1) by address.
    const inAddr = tokenIn.address.toLowerCase()
    const outAddr = tokenOut.address.toLowerCase()
    const zeroForOne = inAddr < outAddr
    const currency0 = zeroForOne ? tokenIn.address : tokenOut.address
    const currency1 = zeroForOne ? tokenOut.address : tokenIn.address

    let amountOut: bigint
    try {
      const result = await client.simulateContract({
        address: dex.quoterAddress,
        abi: V4_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            poolKey: { currency0, currency1, fee, tickSpacing, hooks },
            zeroForOne,
            exactAmount: amountIn,
            hookData: '0x',
          },
        ],
      })
      const [out] = result.result as readonly [bigint, bigint]
      amountOut = out
    } catch {
      // Pool does not exist or has no liquidity at this fee/tickSpacing.
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
      midPriceQ18: priceQ18, // V4 spot quote = execution at this size; mid is approx
      priceImpactBps: 0, // Conservative; the quoter does not return spot pre-trade
      path: [tokenIn, tokenOut],
      routeAddresses: [tokenIn.address, tokenOut.address],
      sources: [
        {
          dexId: dex.id,
          poolAddress: dex.factoryAddress, // V4 has no per-pool address; PoolManager is the singleton
          feeTier: fee,
          tickSpacing,
          amountIn,
          amountOut,
        },
      ],
      liquidityScore: 0n,
      hopVersions: ['v4'],
      estimatedGasUnits: this.estimateGas(['v4']),
      estimatedGasCostWei: gasPriceWei ? gasPriceWei * this.estimateGas(['v4']) : null,
      gasPriceWei,
    }
  }
}
