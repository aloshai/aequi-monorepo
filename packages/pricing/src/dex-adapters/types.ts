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

export interface V4QuoteParams {
  chainId: number
  chainKey: string
  dex: DexConfig
  tokenIn: TokenMetadata
  tokenOut: TokenMetadata
  amountIn: bigint
  /** Pool fee in hundredths of a bip (e.g. 500 = 0.05%). */
  fee: number
  /** Tick spacing chosen by pool creator (paired with fee in chain config). */
  tickSpacing: number
  /** Hook address; Aequi V4 support is hookless-only — always 0x0. */
  hooks: Address
  gasPriceWei: bigint | null
  client: any
}

export interface IDexAdapter {
  readonly protocol: string
  readonly version: 'v2' | 'v3' | 'v4'

  computeV2Quote?(params: V2QuoteParams): Promise<PriceQuote | null>
  computeV3Quote?(params: V3QuoteParams): Promise<PriceQuote | null>
  computeV4Quote?(params: V4QuoteParams): Promise<PriceQuote | null>

  estimateGas(hops: RouteHopVersion[]): bigint
  supportsChain(chainId: number): boolean
}

export type DexAdapterKey = `${string}-v${2 | 3 | 4}`
