import type { ChainKey } from '../types/api'
import type { TokenPreset } from '../data/token-directory'
import type { Token } from '../services/token-manager'

/**
 * Shareable swap state ⇄ URL search params.
 *
 * Params: ?chain=bsc&sell=BNB&buy=USDT&amount=1
 * Tokens are serialized as their symbol when they are a known preset on the
 * chain (readable, shareable) and as their address otherwise (imported tokens),
 * so any link resolves back to the exact pair on load.
 */

const VALID_CHAINS: ChainKey[] = ['ethereum', 'bsc', 'base', 'ink', 'incentiv']

export function parseChainParam(value: string | null): ChainKey | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  return (VALID_CHAINS as string[]).includes(v) ? (v as ChainKey) : null
}

function presetToToken(p: TokenPreset, cid: number): Token {
  return { address: p.address, symbol: p.symbol, name: p.label, decimals: p.decimals, chainId: cid }
}

/**
 * Resolve a `sell`/`buy` param (symbol or address) to a concrete Token using
 * the chain's presets first, then the user's imported tokens. Returns undefined
 * when the value can't be matched (caller falls back to defaults).
 */
export function resolveUrlToken(
  value: string | null,
  presets: TokenPreset[],
  importedTokens: Token[],
  cid: number,
): Token | undefined {
  if (!value) return undefined
  const lower = value.trim().toLowerCase()
  if (!lower) return undefined

  const bySymbol = presets.find(p => p.symbol.toLowerCase() === lower)
  if (bySymbol) return presetToToken(bySymbol, cid)

  const byAddress = presets.find(p => p.address.toLowerCase() === lower)
  if (byAddress) return presetToToken(byAddress, cid)

  const imported = importedTokens.find(
    t => t.chainId === cid && (t.address.toLowerCase() === lower || t.symbol.toLowerCase() === lower),
  )
  if (imported) return imported

  return undefined
}

/** Serialize a token to its shortest unambiguous param (symbol for presets, address otherwise). */
export function tokenToParam(token: Token, presets: TokenPreset[]): string {
  const isPreset = presets.some(p => p.address.toLowerCase() === token.address.toLowerCase())
  return isPreset ? token.symbol : token.address
}

export interface SwapUrlState {
  chain: ChainKey
  tokenA: Token | null
  tokenB: Token | null
  amount: string
}

/** Build the `?...` search string (without leading `?`) for the current swap state. */
export function buildSwapSearch(state: SwapUrlState, presets: TokenPreset[]): string {
  const params = new URLSearchParams()
  params.set('chain', state.chain)
  if (state.tokenA) params.set('sell', tokenToParam(state.tokenA, presets))
  if (state.tokenB) params.set('buy', tokenToParam(state.tokenB, presets))
  const amt = state.amount.trim()
  if (amt && amt !== '0') params.set('amount', amt)
  return params.toString()
}

export interface ParsedSwapParams {
  chain: ChainKey | null
  sell: string | null
  buy: string | null
  amount: string | null
  hasAny: boolean
}

/** Parse the current window location's swap params. */
export function parseSwapParams(search: string): ParsedSwapParams {
  const sp = new URLSearchParams(search)
  const chain = parseChainParam(sp.get('chain'))
  const sell = sp.get('sell')
  const buy = sp.get('buy')
  const amount = sp.get('amount')
  return { chain, sell, buy, amount, hasAny: !!(chain || sell || buy || amount) }
}
