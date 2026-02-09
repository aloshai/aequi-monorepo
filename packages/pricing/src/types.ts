import type { Address, PublicClient } from 'viem'
import type { ChainConfig, ChainKey, PriceQuote, RoutePreference, TokenMetadata } from '@aequi/core'

export interface ChainClientProvider {
  getClient(chain: ChainConfig): Promise<PublicClient>
}

export interface TokenMetadataProvider {
  getTokenMetadata(chain: ChainConfig, address: Address): Promise<TokenMetadata>
}

export interface PriceServiceConfig {
  allowMixedVersions?: boolean
}

export interface PoolDiscoveryConfig {
  intermediateTokenAddresses: Record<ChainKey, Address[]>
  minV2ReserveThreshold: bigint
  minV3LiquidityThreshold: bigint
  maxHopDepth: number
}

export interface QuoteResult {
  quote: PriceQuote
  amountOutMin: bigint
  slippageBps: number
  tokenIn: TokenMetadata
  tokenOut: TokenMetadata
}
