import type { PublicClient } from 'viem'
import type { ChainConfig } from '@aequi/core'

export interface IChainClientProvider {
  getClient(chain: ChainConfig): Promise<PublicClient>
}

export interface IRpcSelector {
  resolveRpcUrls(chain: ChainConfig): Promise<string[]>
}
