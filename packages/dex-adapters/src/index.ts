import { dexRegistry, type DexAdapterRegistry } from '@aequi/pricing'
import { UniswapV2Adapter, UniswapV3Adapter } from './uniswap'
import { PancakeV2Adapter, PancakeV3Adapter } from './pancakeswap'

export * from './uniswap'
export * from './pancakeswap'

export function registerDefaultAdapters(registry: DexAdapterRegistry = dexRegistry): void {
  registry.register(new UniswapV2Adapter())
  registry.register(new UniswapV3Adapter())
  registry.register(new PancakeV2Adapter())
  registry.register(new PancakeV3Adapter())
  console.log('[DexAdapters] Registered 4 default adapters')
}

// Auto-register if registry is available
if (typeof dexRegistry !== 'undefined') {
  registerDefaultAdapters()
}
