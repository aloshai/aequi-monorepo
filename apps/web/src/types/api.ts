export type ChainKey = 'ethereum' | 'bsc' | 'incentiv'

export interface DexSummary {
  id: string
  label: string
  protocol: string
  version: 'v2' | 'v3'
  factoryAddress: string
  routerAddress: string
  feeTiers: number[]
}

export interface ExchangeResponse {
  chain: ChainKey
  dexes: DexSummary[]
}

export interface TokenMetadata {
  address: string
  symbol: string
  name: string
  decimals: number
  totalSupply: string | null
}

export interface TokenResponse {
  chain: ChainKey
  token: TokenMetadata
}

export interface RoutePool {
  dexId: string
  poolAddress: string
  feeTier: number | null
}

export interface RouteToken {
  address: string
  symbol: string
  name: string
  decimals: number
}

export interface RouteSource {
  dexId: string
  poolAddress?: string
  feeTier?: number
  amountIn: string
  amountOut: string
  reserves?: {
    reserve0?: string
    reserve1?: string
    liquidity?: string
    sqrtPriceX96?: string
    tick?: number
    token0?: string
    token1?: string
  }
}

export interface SplitLegResponse {
  ratioBps: number
  quote: PriceResponse
}

export interface PriceResponse {
  chain: ChainKey
  source: string
  path: string[]
  tokens: RouteToken[]
  routeAddresses: string[]
  priceQ18: string
  midPriceQ18: string
  executionPriceQ18: string
  priceImpactBps: number
  amountIn: string
  amountInFormatted: string
  amountOut: string
  amountOutFormatted: string
  liquidityScore: string
  estimatedGasUnits: string | null
  estimatedGasCostWei: string | null
  gasPriceWei: string | null
  hopVersions: ('v2' | 'v3')[]
  routePreference: 'auto' | 'v2' | 'v3'
  pools: RoutePool[]
  sources: RouteSource[]
  isSplit?: boolean
  splits?: SplitLegResponse[]
}

export interface QuoteResponse extends PriceResponse {
  quoteId: string
  expiresAt: number
  amountOutMin: string
  amountOutMinFormatted: string
  slippageBps: number
  recommendedSlippageBps?: number
  feeBps?: number
  feeAmount?: string
  feeAmountFormatted?: string
  offers?: PriceResponse[]
}

export interface AllowanceEntry {
  token: string
  allowance: string
}

export interface AllowanceResponse {
  chain: ChainKey
  owner: string
  spender: string
  allowances: AllowanceEntry[]
}

export interface ApproveResponse {
  chain: ChainKey
  token: string
  spender: string
  amount: string
  decimals: number
  callData: string
  transaction: {
    to: string
    data: string
    value: string
  }
}

export interface RouterCall {
  to: string
  data: string
  value: string
}

/** EIP-712 typed-data payload + slippage tuple returned for `settler-permit2`. */
export interface Permit2PayloadResponse {
  typedData: {
    domain: {
      name: string
      chainId: number
      verifyingContract: string
    }
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: 'PermitWitnessTransferFrom'
    message: {
      permitted: { token: string; amount: string }
      spender: string
      nonce: string
      deadline: string
      witness: {
        recipient: string
        buyToken: string
        minAmountOut: string
        actions: string[]
      }
    }
  }
  slippage: {
    recipient: string
    buyToken: string
    minAmountOut: string
  }
  actions: string[]
  msgSender: string
  zid: string
}

export interface SwapTransactionPayload {
  kind: 'settler-allowance-holder' | 'settler-permit2'
  dexId: string
  router: string
  spender: string
  amountIn: string
  amountOut: string
  amountOutMinimum: string
  deadline: number
  call: RouterCall
  permit2: Permit2PayloadResponse | null
  estimatedGas?: string
}

export interface SwapResponse extends QuoteResponse {
  recipient: string
  deadline: number
  quoteTimestamp: number
  quoteExpiresAt: number
  quoteValidSeconds: number
  quoteBlockNumber: string | null
  quoteBlockTimestamp: number | null
  simulationPassed: boolean
  transaction: SwapTransactionPayload
}
