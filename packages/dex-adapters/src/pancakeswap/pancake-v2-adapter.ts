import { CurrencyAmount, Token } from '@pancakeswap/swap-sdk-core'
import { Pair } from '@pancakeswap/v2-sdk'
import type { PriceQuote, RouteHopVersion } from '@aequi/core'
import {
  BaseDexAdapter,
  type V2QuoteParams,
  computeExecutionPriceQ18,
  computeMidPriceQ18FromReserves,
  computePriceImpactBps,
  toRawAmount,
  sameAddress,
} from '@aequi/pricing'

export class PancakeV2Adapter extends BaseDexAdapter {
  readonly protocol = 'pancakeswap'
  readonly version = 'v2' as const
  
  async computeV2Quote(params: V2QuoteParams): Promise<PriceQuote | null> {
    const {
      chainId,
      chainKey,
      dex,
      tokenIn,
      tokenOut,
      amountIn,
      poolAddress,
      reserve0,
      reserve1,
      token0,
      gasPriceWei,
    } = params
    
    const reserveIn = sameAddress(token0, tokenIn.address) ? reserve0 : reserve1
    const reserveOut = sameAddress(token0, tokenIn.address) ? reserve1 : reserve0
    
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
    
    const reserveInAmount = CurrencyAmount.fromRawAmount(tokenInInstance, reserveIn.toString())
    const reserveOutAmount = CurrencyAmount.fromRawAmount(tokenOutInstance, reserveOut.toString())
    
    const pair = new Pair(reserveInAmount as any, reserveOutAmount as any)
    const inputAmount = CurrencyAmount.fromRawAmount(tokenInInstance, amountIn.toString())
    
    let amountOutRaw: bigint
    try {
      const [amountOutCurrency] = pair.getOutputAmount(inputAmount as any)
      amountOutRaw = toRawAmount(amountOutCurrency)
    } catch (error) {
      console.warn(`[PancakeV2] Quote failed for ${tokenIn.symbol}->${tokenOut.symbol}:`, (error as Error).message)
      return null
    }
    
    if (amountOutRaw <= 0n) {
      return null
    }
    
    const midPriceQ18 = computeMidPriceQ18FromReserves(
      this.protocol,
      reserveIn,
      reserveOut,
      tokenIn.decimals,
      tokenOut.decimals
    )
    
    const executionPriceQ18 = computeExecutionPriceQ18(
      amountIn,
      amountOutRaw,
      tokenIn.decimals,
      tokenOut.decimals
    )
    
    const priceImpactBps = computePriceImpactBps(
      midPriceQ18,
      amountIn,
      amountOutRaw,
      tokenIn.decimals,
      tokenOut.decimals
    )
    
    const hopVersions: RouteHopVersion[] = ['v2']
    const estimatedGasUnits = this.estimateGas(hopVersions)
    const estimatedGasCostWei = gasPriceWei ? gasPriceWei * estimatedGasUnits : null
    
    return {
      chain: chainKey as any,
      amountIn,
      amountOut: amountOutRaw,
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
          amountIn,
          amountOut: amountOutRaw,
          reserves: {
            reserve0,
            reserve1,
            token0,
            token1: sameAddress(token0, tokenIn.address) ? tokenOut.address : tokenIn.address,
          },
        },
      ],
      liquidityScore: reserveIn + reserveOut,
      hopVersions,
      estimatedGasUnits,
      estimatedGasCostWei,
      gasPriceWei,
    }
  }
}
