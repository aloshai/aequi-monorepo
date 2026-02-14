import type { Address } from 'viem'
import type { ChainConfig, PriceQuote, RouteHopVersion, RoutePreference, TokenMetadata } from '@aequi/core'
import { defaultAmountForDecimals } from './units'
import { compareQuotes } from './quote-math'
import { findBestSplit, type SplitOptimizerConfig } from './split-optimizer'
import { Q18 } from './math'
import type { ChainClientProvider, QuoteResult } from './types'
import type { TokenService } from './token-service'
import { PoolDiscovery } from './pool-discovery'

const resolveAllowedVersions = (preference: RoutePreference): RouteHopVersion[] => {
  if (preference === 'auto') {
    return ['v3', 'v2']
  }
  return [preference]
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

export class PriceService {
  private readonly splitConfig: SplitOptimizerConfig | null

  constructor(
    private readonly tokenService: TokenService,
    private readonly clientProvider: ChainClientProvider,
    private readonly poolDiscovery: PoolDiscovery,
    splitConfig?: SplitOptimizerConfig | null,
  ) {
    this.splitConfig = splitConfig ?? null
  }

  async getBestPrice(
    chain: ChainConfig,
    tokenA: Address,
    tokenB: Address,
    amountIn?: bigint,
    preference: RoutePreference = 'auto',
    forceMultiHop?: boolean,
    enableSplit?: boolean,
  ): Promise<PriceQuote | null> {
    const [tokenIn, tokenOut] = await Promise.all([
      this.tokenService.getTokenMetadata(chain, tokenA),
      this.tokenService.getTokenMetadata(chain, tokenB),
    ])

    const effectiveAmountIn = amountIn && amountIn > 0n
      ? amountIn
      : defaultAmountForDecimals(tokenIn.decimals)

    return this.getBestQuoteForTokens(chain, tokenIn, tokenOut, effectiveAmountIn, preference, forceMultiHop, enableSplit)
  }

  async getBestQuoteForTokens(
    chain: ChainConfig,
    tokenIn: TokenMetadata,
    tokenOut: TokenMetadata,
    amountIn: bigint,
    preference: RoutePreference = 'auto',
    forceMultiHop?: boolean,
    enableSplit?: boolean,
  ): Promise<PriceQuote | null> {
    if (amountIn <= 0n) {
      return null
    }

    const allowedVersions = resolveAllowedVersions(preference)
    const client = await this.clientProvider.getClient(chain)

    let gasPriceWei: bigint | null = null
    try {
      gasPriceWei = await client.getGasPrice()
    } catch {
      gasPriceWei = null
    }

    const [directQuotes, multiHopQuotes] = await Promise.all([
      forceMultiHop ? Promise.resolve([]) : this.poolDiscovery.fetchDirectQuotes(chain, tokenIn, tokenOut, amountIn, gasPriceWei, client, allowedVersions),
      this.poolDiscovery.fetchMultiHopQuotes(chain, tokenIn, tokenOut, amountIn, gasPriceWei, client, allowedVersions),
    ])

    const candidates = forceMultiHop ? multiHopQuotes : [...directQuotes, ...multiHopQuotes]

    const nativeToOutputPriceQ18 = this.resolveNativeToOutputPrice(chain, tokenOut, candidates)
    const gasAwareSorter = (a: PriceQuote, b: PriceQuote) =>
      compareQuotes(a, b, nativeToOutputPriceQ18, tokenOut.decimals)

    const shouldSplit = enableSplit !== false && this.splitConfig !== null
    if (shouldSplit && candidates.length >= 2) {
      const sorted = [...candidates].sort(gasAwareSorter)

      const splitConfig = { ...this.splitConfig!, nativeToOutputPriceQ18 }
      const splitResult = findBestSplit(sorted, amountIn, splitConfig)

      if (splitResult) {
        const remaining = sorted.filter((q) => q !== sorted[0]).sort(gasAwareSorter)
        if (remaining.length) {
          splitResult.offers = remaining
        }
        return splitResult
      }
    }

    const sorted = [...candidates].sort(gasAwareSorter)
    const best = sorted[0] ?? null
    if (!best) {
      return null
    }

    const remaining = sorted.slice(1)
    if (remaining.length) {
      best.offers = remaining
    }

    return best
  }

  async buildQuoteResult(
    chain: ChainConfig,
    tokenInAddress: Address,
    tokenOutAddress: Address,
    amount: string,
    slippageBps: number,
    preference: RoutePreference = 'auto',
    forceMultiHop: boolean = false,
    parseAmount: (value: string, decimals: number) => bigint,
  ): Promise<QuoteResult | null> {
    if (tokenInAddress.toLowerCase() === tokenOutAddress.toLowerCase()) {
      return null
    }

    const [tokenIn, tokenOut] = await Promise.all([
      this.tokenService.getTokenMetadata(chain, tokenInAddress),
      this.tokenService.getTokenMetadata(chain, tokenOutAddress),
    ])

    const amountIn = parseAmount(amount, tokenIn.decimals)
    if (amountIn <= 0n) {
      throw new Error('Amount must be greater than zero')
    }

    const quote = await this.getBestQuoteForTokens(chain, tokenIn, tokenOut, amountIn, preference, forceMultiHop)
    if (!quote) {
      return null
    }

    const boundedSlippage = clampSlippage(slippageBps)
    const slippageAmount = (quote.amountOut * BigInt(boundedSlippage)) / 10000n
    const amountOutMin = quote.amountOut > slippageAmount ? quote.amountOut - slippageAmount : 0n

    return {
      quote,
      amountOutMin,
      slippageBps: boundedSlippage,
      tokenIn,
      tokenOut,
    }
  }

  private resolveNativeToOutputPrice(
    chain: ChainConfig,
    tokenOut: TokenMetadata,
    candidates: PriceQuote[],
  ): bigint | undefined {
    const wrappedNative = chain.wrappedNativeAddress?.toLowerCase()
    if (!wrappedNative) return undefined

    // Output token IS the wrapped native token → 1:1
    if (tokenOut.address.toLowerCase() === wrappedNative) {
      return Q18
    }

    // Look through multi-hop candidates for a route that uses wrapped native as intermediate
    for (const q of candidates) {
      for (let i = 0; i < q.sources.length; i++) {
        const source = q.sources[i]!
        const hopOut = q.path[i + 1]
        const hopIn = q.path[i]
        if (!hopOut || !hopIn) continue

        // Found a hop: WETH/WBNB → outputToken (or intermediate that eventually leads to outputToken)
        if (hopIn.address.toLowerCase() === wrappedNative && hopOut.address.toLowerCase() === tokenOut.address.toLowerCase()) {
          return source.amountIn > 0n
            ? (source.amountOut * Q18 * 10n ** BigInt(hopIn.decimals)) / (source.amountIn * 10n ** BigInt(hopOut.decimals))
            : undefined
        }

        // Found a hop: outputToken → WETH/WBNB (inverse)
        if (hopOut.address.toLowerCase() === wrappedNative && hopIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
          return source.amountOut > 0n
            ? (source.amountIn * Q18 * 10n ** BigInt(hopOut.decimals)) / (source.amountOut * 10n ** BigInt(hopIn.decimals))
            : undefined
        }
      }
    }

    return undefined
  }
}
