import type { IDexAdapter, DexAdapterKey } from './types'

export class DexAdapterRegistry {
  private readonly adapters = new Map<DexAdapterKey, IDexAdapter>()
  
  register(adapter: IDexAdapter): void {
    const key = `${adapter.protocol}-${adapter.version}` as DexAdapterKey
    this.adapters.set(key, adapter)
    console.log(`[DexRegistry] Registered adapter: ${key}`)
  }
  
  get(protocol: string, version: 'v2' | 'v3'): IDexAdapter | undefined {
    const key = `${protocol}-${version}` as DexAdapterKey
    return this.adapters.get(key)
  }
  
  getAll(): IDexAdapter[] {
    return Array.from(this.adapters.values())
  }
  
  has(protocol: string, version: 'v2' | 'v3'): boolean {
    const key = `${protocol}-${version}` as DexAdapterKey
    return this.adapters.has(key)
  }
}

export const dexRegistry = new DexAdapterRegistry()
