export * from './types'
export * from './token-service'
export * from './pool-discovery'
export * from './price-service'
export * from './quote-math'
export * from './route-planner'
export * from './units'
export * from './math'
export * from './contracts'

// Adapter infrastructure exports (for custom adapter development)
export { BaseDexAdapter } from './dex-adapters/base-adapter'
export { dexRegistry, DexAdapterRegistry } from './dex-adapters/registry'
export type { IDexAdapter, V2QuoteParams, V3QuoteParams, DexAdapterKey } from './dex-adapters/types'
