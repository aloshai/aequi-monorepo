import { Token } from '@pancakeswap/swap-sdk-core'
import { Pool } from '@pancakeswap/v3-sdk'
import type { PriceQuote, RouteHopVersion } from '@aequi/core'
import {
  BaseDexAdapter,
  type V3QuoteParams,
  computeExecutionPriceQ18,
  computeMidPriceQ18FromPrice,
  computePriceImpactBps,
  V3_QUOTER_ABI,
} from '@aequi/pricing'

export class PancakeV3Adapter extends BaseDexAdapter {
  readonly protocol = 'pancakeswap'
  readonly version = 'v3' as const
  
  async computeV3Quote(params: V3QuoteParams): Promise<PriceQuote | null> {
    const {
      chainId,
      chainKey,
      dex,
      tokenIn,
      tokenOut,
      amountIn,
      sqrtPriceX96,
      tick,
      liquidity,
      token0,
      token1,
      fee,
      poolAddress,
      gasPriceWei,
      client,
    } = params

    if (!dex.quoterAddress) {
      console.warn(`[PancakeV3] Missing quoter address for DEX ${dex.id}`)
      return null
    }
    
    try {
      const quoterResult = await client.readContract({
        address: dex.quoterAddress,
        abi: V3_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [{
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0n,
        }],
      })

      const [amountOut] = quoterResult as readonly [bigint, bigint, number, bigint]

      if (amountOut <= 0n) {
        return null
      }

      const tokenInInstance = new Token(
        chainId,
        tokenIn.address,
        tokenIn.decimals,
        tokenIn.symbol,
        tokenIn.name
      )
      
      const tokenOutInstance = new Token(
        chainId,
        tokenOut.address,
        tokenOut.decimals,
        tokenOut.symbol,
        tokenOut.name
      )
      
      const pool = new Pool(
        tokenInInstance,
        tokenOutInstance,
        fee,
        sqrtPriceX96.toString(),
        liquidity.toString(),
        tick
      )
      
      const isToken0In = tokenIn.address.toLowerCase() < tokenOut.address.toLowerCase()
      const directionalPrice = isToken0In ? pool.token0Price : pool.token1Price

      const midPriceQ18 = computeMidPriceQ18FromPrice(
        this.protocol,
        tokenInInstance as any,
        tokenOut.decimals,
        directionalPrice
      )
      
      const executionPriceQ18 = computeExecutionPriceQ18(
        amountIn,
        amountOut,
        tokenIn.decimals,
        tokenOut.decimals
      )
      
      const priceImpactBps = computePriceImpactBps(
        midPriceQ18,
        amountIn,
        amountOut,
        tokenIn.decimals,
        tokenOut.decimals
      )

      const hopVersions: RouteHopVersion[] = ['v3']
      const estimatedGasUnits = this.estimateGas(hopVersions)
      const estimatedGasCostWei = gasPriceWei ? gasPriceWei * estimatedGasUnits : null
      
      return {
        chain: chainKey as any,
        amountIn,
        amountOut,
        priceQ18: executionPriceQ18,
        executionPriceQ18,
        midPriceQ18,
        priceImpactBps,
        path: [tokenIn, tokenOut],
        routeAddresses: [tokenIn.address, tokenOut.address],
        sources: [
          {
            dexId: dex.id,
            poolAddress,
            feeTier: fee,
            amountIn,
            amountOut,
            reserves: {
              liquidity,
              sqrtPriceX96,
              tick,
              token0,
              token1,
            },
          },
        ],
        liquidityScore: liquidity,
        hopVersions,
        estimatedGasUnits,
        estimatedGasCostWei,
        gasPriceWei,
      }
    } catch (error) {
      console.warn(`[PancakeV3] Quoter call failed for ${tokenIn.symbol}->${tokenOut.symbol}:`, (error as Error).message)
      return null
    }
  }
}
