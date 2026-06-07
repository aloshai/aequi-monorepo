import type { Address, Chain } from 'viem'

export type ChainKey = 'ethereum' | 'bsc' | 'incentiv' | 'ink' | 'base'

export type RouteHopVersion = 'v2' | 'v3' | 'v4'
export type RoutePreference = 'auto' | RouteHopVersion

export interface DexConfig {
  id: string
  label: string
  /**
   * Identifies the on-chain protocol family. Used by the dex-adapters
   * registry to pick the right adapter (e.g. `uniswap-v3` adapter for
   * Pancake V3, but `velodrome-slipstream` for Velodrome's CL because
   * its factory uses tickSpacing rather than fee as the pool key).
   */
  protocol: 'uniswap' | 'pancakeswap' | 'incentive-portal' | 'velodrome-slipstream'
  version: 'v2' | 'v3' | 'v4'
  /**
   * V4 uses a singleton PoolManager rather than per-pool factories. For v4
   * dexes this is the PoolManager address itself.
   */
  factoryAddress: Address
  /**
   * V4 does not have a swap router — routing happens via Settler's
   * UNISWAPV4 action against PoolManager directly. For v4 entries this is
   * a placeholder (set equal to factoryAddress).
   */
  routerAddress: Address
  quoterAddress?: Address
  feeTiers?: number[]
  initCodeHash?: `0x${string}`
  useRouter02?: boolean // For Uniswap V3 Router02 (different ABI without deadline in struct)
  /**
   * V4 only: known (fee, tickSpacing) pairs the discovery layer probes.
   * Standard Uniswap V4 deployment uses [[100,1],[500,10],[3000,60],[10000,200]].
   */
  v4TickSpacings?: ReadonlyArray<readonly [fee: number, tickSpacing: number]>
  /**
   * Slipstream-style V3 forks (Velodrome, Aerodrome) key pools by
   * tickSpacing rather than fee. When set, the pool discovery layer probes
   * `factory.getPool(token0, token1, tickSpacing)` for each value here
   * (instead of iterating `feeTiers`). For Velodrome the default set is
   * [1, 50, 100, 200, 2000] (matches the factory's enableTickSpacing).
   */
  slipstreamTickSpacings?: ReadonlyArray<number>
}

export interface SettlerChainAddresses {
  /** Per-chain Settler in AllowanceHolder (taker-submitted) mode. null = not configured yet. */
  settler: Address | null
  /** Per-chain SettlerMetaTxn in Permit2 mode. null = not configured yet. */
  settlerMetaTxn: Address | null
  /** AllowanceHolder is identical across all chains (deterministic CREATE2). */
  allowanceHolder: Address
  /** Canonical Permit2, identical across all EVM chains. */
  permit2: Address
}

export interface ChainConfig {
  key: ChainKey
  id: number
  name: string
  nativeCurrencySymbol: string
  wrappedNativeAddress: Address
  rpcUrls: string[]
  fallbackRpcUrls?: string[]
  disablePublicRpcRegistry?: boolean
  viemChain: Chain
  dexes: DexConfig[]
  settler?: SettlerChainAddresses
}

export interface TokenMetadata {
  chainId: number
  address: Address
  symbol: string
  name: string
  decimals: number
  totalSupply: bigint | null
}

export interface PriceSource {
  dexId: string
  poolAddress: Address
  feeTier?: number
  /** V4 only — tick spacing chosen by pool creator. V3 forks derive this from fee. */
  tickSpacing?: number
  approximate?: boolean
  amountIn: bigint
  amountOut: bigint
  reserves?: {
    reserve0?: bigint
    reserve1?: bigint
    liquidity?: bigint
    sqrtPriceX96?: bigint
    tick?: number
    token0?: Address
    token1?: Address
  }
}

export interface SplitLeg {
  quote: PriceQuote
  ratioBps: number
}

export interface PriceQuote {
  chain: ChainKey
  amountIn: bigint
  amountOut: bigint
  priceQ18: bigint
  executionPriceQ18: bigint
  midPriceQ18: bigint
  priceImpactBps: number
  path: TokenMetadata[]
  routeAddresses: Address[]
  sources: PriceSource[]
  liquidityScore: bigint
  hopVersions: RouteHopVersion[]
  estimatedGasUnits: bigint | null
  estimatedGasCostWei: bigint | null
  gasPriceWei: bigint | null
  offers?: PriceQuote[]
  isSplit?: boolean
  splits?: SplitLeg[]
}

export interface QuoteResult {
  quote: PriceQuote
  amountOutMin: bigint
  slippageBps: number
  tokenIn: TokenMetadata
  tokenOut: TokenMetadata
  estimatedGas?: bigint
  quoteId?: string
  expiresAt?: number
  feeBps?: number
  feeAmount?: bigint
}
