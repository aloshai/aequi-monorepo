import { getChainConfig, SUPPORTED_CHAINS } from '../config/chains'
import { NATIVE_ADDRESS } from '../config/constants'
import { normalizeAddress } from './trading'
import { formatAmountFromUnits } from './units'
import type { Address } from 'viem'
import type { ChainConfig, PriceQuote, RoutePreference } from '../types'

export const resolveChain = (chainParam: string): ChainConfig => {
  const chain = getChainConfig(chainParam)
  if (!chain) {
    throw new Error(`Unsupported chain '${chainParam}'. Supported chains: ${SUPPORTED_CHAINS.join(', ')}`)
  }
  return chain
}

export const resolveRoutePreference = (value?: string): RoutePreference => {
  if (!value) return 'auto'
  const normalized = value.toLowerCase()
  if (normalized === 'v2' || normalized === 'v3') return normalized
  return 'auto'
}

export const isNativeAddress = (addr: string): boolean =>
  addr.toLowerCase() === NATIVE_ADDRESS.toLowerCase()

export const resolveEffectiveTokens = (
  tokenA: string,
  tokenB: string,
  chain: ChainConfig,
): { effectiveTokenA: Address; effectiveTokenB: Address; useNativeInput: boolean; useNativeOutput: boolean } => {
  const normalizedA = normalizeAddress(tokenA).toLowerCase() as Address
  const normalizedB = normalizeAddress(tokenB).toLowerCase() as Address
  const useNativeInput = isNativeAddress(normalizedA)
  const useNativeOutput = isNativeAddress(normalizedB)
  const effectiveTokenA = useNativeInput ? chain.wrappedNativeAddress.toLowerCase() as Address : normalizedA
  const effectiveTokenB = useNativeOutput ? chain.wrappedNativeAddress.toLowerCase() as Address : normalizedB
  return { effectiveTokenA, effectiveTokenB, useNativeInput, useNativeOutput }
}

export const formatPriceQuote = (chain: ChainConfig, quote: PriceQuote, routePreference: RoutePreference): any => {
  const tokenIn = quote.path[0]!
  const tokenOut = quote.path[quote.path.length - 1]!

  const pathSymbols = quote.path.map((token) => token.symbol ?? token.address)
  const tokenPath = quote.path.map((token) => ({
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
  }))

  const pools = quote.sources.map((source) => ({
    dexId: source.dexId,
    poolAddress: source.poolAddress,
    feeTier: source.feeTier ?? null,
  }))

  const sourceLabel = pools
    .map((source) => (source.feeTier ? `${source.dexId}@${source.feeTier}` : source.dexId))
    .join(' > ')

  const sources = quote.sources.map((source) => ({
    dexId: source.dexId,
    poolAddress: source.poolAddress,
    feeTier: source.feeTier,
    amountIn: source.amountIn.toString(),
    amountOut: source.amountOut.toString(),
    reserves: source.reserves ? {
      reserve0: source.reserves.reserve0?.toString(),
      reserve1: source.reserves.reserve1?.toString(),
      liquidity: source.reserves.liquidity?.toString(),
      sqrtPriceX96: source.reserves.sqrtPriceX96?.toString(),
      tick: source.reserves.tick,
      token0: source.reserves.token0,
      token1: source.reserves.token1,
    } : undefined,
  }))

  const amountInFormatted = formatAmountFromUnits(quote.amountIn, tokenIn.decimals)
  const amountOutFormatted = formatAmountFromUnits(quote.amountOut, tokenOut.decimals)

  const offers = quote.offers?.map(offer => formatPriceQuote(chain, offer, routePreference))

  return {
    chain: chain.key,
    source: sourceLabel,
    path: pathSymbols,
    tokens: tokenPath,
    routeAddresses: quote.routeAddresses,
    priceQ18: quote.priceQ18.toString(),
    midPriceQ18: quote.midPriceQ18.toString(),
    executionPriceQ18: quote.executionPriceQ18.toString(),
    priceImpactBps: quote.priceImpactBps,
    amountIn: quote.amountIn.toString(),
    amountInFormatted,
    amountOut: quote.amountOut.toString(),
    amountOutFormatted,
    liquidityScore: quote.liquidityScore.toString(),
    estimatedGasUnits: quote.estimatedGasUnits ? quote.estimatedGasUnits.toString() : null,
    estimatedGasCostWei: quote.estimatedGasCostWei ? quote.estimatedGasCostWei.toString() : null,
    gasPriceWei: quote.gasPriceWei ? quote.gasPriceWei.toString() : null,
    hopVersions: quote.hopVersions,
    routePreference,
    pools,
    sources,
    offers,
    ...(quote.isSplit && quote.splits ? {
      isSplit: true,
      splits: quote.splits.map((leg) => ({
        ratioBps: leg.ratioBps,
        quote: formatPriceQuote(chain, leg.quote, routePreference),
      })),
    } : {}),
  }
}
