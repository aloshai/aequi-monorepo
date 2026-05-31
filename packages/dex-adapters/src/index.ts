import { dexRegistry, type DexAdapterRegistry } from '@aequi/pricing'
import { UniswapV2Adapter, UniswapV3Adapter, UniswapV4Adapter } from './uniswap'
import { PancakeV2Adapter, PancakeV3Adapter } from './pancakeswap'
import { IncentivePortalV3Adapter } from './incentive-portal'
import { VelodromeSlipstreamAdapter } from './velodrome'

export * from './uniswap'
export * from './pancakeswap'
export * from './incentive-portal'
export * from './velodrome'

export function registerDefaultAdapters(registry: DexAdapterRegistry = dexRegistry): void {
  registry.register(new UniswapV2Adapter())
  registry.register(new UniswapV3Adapter())
  registry.register(new UniswapV4Adapter())
  registry.register(new PancakeV2Adapter())
  registry.register(new PancakeV3Adapter())
  registry.register(new IncentivePortalV3Adapter())
  registry.register(new VelodromeSlipstreamAdapter())
  console.log('[DexAdapters] Registered 7 default adapters')
}

// Auto-register if registry is available
if (typeof dexRegistry !== 'undefined') {
  registerDefaultAdapters()
}
