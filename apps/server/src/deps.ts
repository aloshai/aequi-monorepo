import { TokenService, PriceService, PoolDiscovery } from '@aequi/pricing'
import { registerDefaultAdapters } from '@aequi/dex-adapters'
import { SwapBuilder } from '@aequi/core'
import { appConfig } from './config/app-config'
import {
  AEQUI_EXECUTOR_ADDRESS,
  EXECUTOR_INTERHOP_BUFFER_BPS,
  SWAP_QUOTE_TTL_SECONDS,
  INTERMEDIATE_TOKENS,
  INTERMEDIATE_TOKEN_ADDRESSES,
  MIN_V2_RESERVE_THRESHOLD,
  MIN_V3_LIQUIDITY_THRESHOLD,
} from './config/constants'
import { ExchangeService } from './services/exchange/exchange-service'
import { QuoteService } from './services/quote/quote-service'
import { AllowanceService } from './services/tokens/allowance-service'
import { DefaultChainClientProvider } from './services/clients/default-chain-client-provider'
import { HealthService } from './services/health/health-service'
import { TtlCache } from './utils/ttl-cache'
import { QuoteStore } from './utils/quote-store'
import type { QuoteResult } from './types'

export interface AppDeps {
  chainClientProvider: DefaultChainClientProvider
  exchangeService: ExchangeService
  tokenService: TokenService
  poolDiscovery: PoolDiscovery
  priceService: PriceService
  quoteService: QuoteService
  quoteCache: TtlCache<QuoteResult>
  quoteStore: QuoteStore
  allowanceService: AllowanceService
  swapBuilder: SwapBuilder
  healthService: HealthService
}

export function createDeps(): AppDeps {
  registerDefaultAdapters()

  const chainClientProvider = new DefaultChainClientProvider()
  const exchangeService = new ExchangeService()
  const tokenService = new TokenService(chainClientProvider, { preloadTokens: INTERMEDIATE_TOKENS })
  const poolDiscovery = new PoolDiscovery(tokenService, chainClientProvider, {
    intermediateTokenAddresses: INTERMEDIATE_TOKEN_ADDRESSES,
    minV2ReserveThreshold: MIN_V2_RESERVE_THRESHOLD,
    minV3LiquidityThreshold: MIN_V3_LIQUIDITY_THRESHOLD,
    maxHopDepth: appConfig.routing.maxHopDepth,
  })
  const priceService = new PriceService(
    tokenService, chainClientProvider, poolDiscovery,
    appConfig.routing.enableSplitRouting ? {
      maxSplitLegs: appConfig.routing.maxSplitLegs,
      convergenceThresholdBps: appConfig.routing.splitConvergenceThresholdBps,
      maxIterations: appConfig.routing.splitMaxIterations,
      minLegRatioBps: appConfig.routing.splitMinLegRatioBps,
    } : null,
  )
  const quoteService = new QuoteService(tokenService, priceService)
  const quoteCache = new TtlCache<QuoteResult>(5_000)
  const quoteStore = new QuoteStore(SWAP_QUOTE_TTL_SECONDS * 1000)
  const allowanceService = new AllowanceService(tokenService, chainClientProvider)
  const swapBuilder = new SwapBuilder({
    executorByChain: AEQUI_EXECUTOR_ADDRESS,
    interhopBufferBps: EXECUTOR_INTERHOP_BUFFER_BPS,
  })
  const healthService = new HealthService()

  return {
    chainClientProvider,
    exchangeService,
    tokenService,
    poolDiscovery,
    priceService,
    quoteService,
    quoteCache,
    quoteStore,
    allowanceService,
    swapBuilder,
    healthService,
  }
}
