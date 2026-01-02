import type { ChainConfig } from '@aequi/core'
import { resolveRpcUrls } from '../rpc/rpc-registry'
import type { IRpcSelector } from './types'

export class DefaultRpcSelector implements IRpcSelector {
  resolveRpcUrls(chain: ChainConfig): Promise<string[]> {
    return resolveRpcUrls(chain)
  }
}
