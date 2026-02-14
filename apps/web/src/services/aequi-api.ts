import type {
  AllowanceResponse,
  ApproveResponse,
  ChainKey,
  ExchangeResponse,
  PriceResponse,
  QuoteResponse,
  SwapResponse,
  TokenResponse,
} from '../types/api'
import { http } from '../lib/http'

export interface ExchangeParams {
  chain: ChainKey
}

export interface TokenParams {
  chain: ChainKey
  address: string
}

export interface PriceParams {
  chain: ChainKey
  tokenA: string
  tokenB: string
  amount?: string
  version?: 'auto' | 'v2' | 'v3'
}

export interface QuoteParams {
  chain: ChainKey
  tokenA: string
  tokenB: string
  amount: string
  slippageBps?: string
  version?: 'auto' | 'v2' | 'v3'
  forceMultiHop?: 'true'
}

export interface AllowanceParams {
  chain: ChainKey
  owner: string
  spender: string
  tokens: string[]
}

export interface ApproveParams {
  chain: ChainKey
  token: string
  spender: string
  amount?: string
  infinite?: boolean
}

export interface SwapParams {
  chain: ChainKey
  tokenA: string
  tokenB: string
  amount: string
  slippageBps?: number
  version?: 'auto' | 'v2' | 'v3'
  recipient: string
  deadlineSeconds?: number
  forceMultiHop?: boolean
  quoteId?: string
}

export const fetchExchangeDirectory = async (params: ExchangeParams): Promise<ExchangeResponse> => {
  const { data } = await http.get<ExchangeResponse>('/exchange', { params })
  return data
}

export const fetchTokenMetadata = async (params: TokenParams): Promise<TokenResponse> => {
  const { data } = await http.get<TokenResponse>('/token', { params })
  return data
}

export const fetchPriceSnapshot = async (params: PriceParams): Promise<PriceResponse> => {
  const { data } = await http.get<PriceResponse>('/price', { params })
  return data
}

export const fetchSwapQuote = async (params: QuoteParams): Promise<QuoteResponse> => {
  const { data } = await http.get<QuoteResponse>('/quote', { params })
  return data
}

export const fetchAllowances = async (params: AllowanceParams): Promise<AllowanceResponse> => {
  const tokensParam = params.tokens.join(',')
  const { data } = await http.get<AllowanceResponse>('/allowance', {
    params: { chain: params.chain, owner: params.owner, spender: params.spender, tokens: tokensParam },
  })
  return data
}

export const requestApproveCalldata = async (payload: ApproveParams): Promise<ApproveResponse> => {
  const { data } = await http.post<ApproveResponse>('/approve', payload)
  return data
}

export const requestSwapTransaction = async (payload: SwapParams): Promise<SwapResponse> => {
  const { data } = await http.post<SwapResponse>('/swap', payload)
  return data
}
