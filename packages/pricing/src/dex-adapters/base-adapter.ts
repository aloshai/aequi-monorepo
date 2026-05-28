import type { RouteHopVersion } from '@aequi/core'
import type { IDexAdapter } from './types'

export abstract class BaseDexAdapter implements IDexAdapter {
  abstract readonly protocol: string
  abstract readonly version: 'v2' | 'v3' | 'v4'

  protected readonly GAS_BASE = 50000n
  protected readonly GAS_V2_SWAP = 70000n
  protected readonly GAS_V3_SWAP = 110000n
  protected readonly GAS_V4_SWAP = 110000n
  protected readonly GAS_MULTI_HOP_OVERHEAD = 20000n

  estimateGas(hops: RouteHopVersion[]): bigint {
    if (!hops.length) {
      return this.GAS_BASE
    }

    const base = hops.reduce((total, hop) => {
      if (hop === 'v2') return total + this.GAS_V2_SWAP
      if (hop === 'v4') return total + this.GAS_V4_SWAP
      return total + this.GAS_V3_SWAP
    }, this.GAS_BASE)

    if (hops.length === 1) {
      return base
    }

    return base + BigInt(hops.length - 1) * this.GAS_MULTI_HOP_OVERHEAD
  }

  supportsChain(_chainId: number): boolean {
    return true
  }
}
