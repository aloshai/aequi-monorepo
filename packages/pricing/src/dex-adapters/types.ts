import type { Address } from 'viem'
import type { DexConfig, PriceQuote, RouteHopVersion, TokenMetadata } from '@aequi/core'

export interface V2QuoteParams {
  chainId: number
  chainKey: string
  dex: DexConfig
  tokenIn: TokenMetadata
  tokenOut: TokenMetadata
  amountIn: bigint
  poolAddress: Address
  reserve0: bigint
  reserve1: bigint
  token0: Address
  gasPriceWei: bigint | null
  minReserveThreshold: bigint
}

export interface V3QuoteParams {
  chainId: number
  chainKey: string
  dex: DexConfig
  tokenIn: TokenMetadata
  tokenOut: TokenMetadata
  amountIn: bigint
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  token0: Address
  token1: Address
  fee: number
  poolAddress: Address
  gasPriceWei: bigint | null
  client: any
}

export interface IDexAdapter {
  readonly protocol: string
  readonly version: 'v2' | 'v3'
  
  computeV2Quote?(params: V2QuoteParams): Promise<PriceQuote | null>
  computeV3Quote?(params: V3QuoteParams): Promise<PriceQuote | null>
  
  estimateGas(hops: RouteHopVersion[]): bigint
  supportsChain(chainId: number): boolean
}

export type DexAdapterKey = `${string}-v${2 | 3}`
