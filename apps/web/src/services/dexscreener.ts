import { isAddress, getAddress } from 'viem'
import type { Token } from './token-manager'
import { fetchTokenMetadata } from './aequi-api'
import type { ChainKey } from '../types/api'

const BASE_URL = 'https://api.dexscreener.com/latest/dex'

// DexScreener chain slugs for the chains Aequi supports. Used both to filter
// search results to the active chain and to build token logo URLs. Chains
// absent here (e.g. Incentiv) have no DexScreener coverage — they rely on the
// paste-an-address path, which resolves metadata on-chain via /token.
const DEXSCREENER_SLUG: Partial<Record<ChainKey, string>> = {
  ethereum: 'ethereum',
  bsc: 'bsc',
  base: 'base',
  ink: 'ink',
}

const logoUrl = (slug: string | undefined, address: string): string | undefined =>
  slug ? `https://dd.dexscreener.com/ds-data/tokens/${slug}/${address.toLowerCase()}.png` : undefined

export interface DexScreenerPair {
    chainId: string
    dexId: string
    url: string
    pairAddress: string
    baseToken: {
        address: string
        name: string
        symbol: string
    }
    quoteToken: {
        address: string
        name: string
        symbol: string
    }
    priceNative: string
    priceUsd: string
    txns: {
        m5: { buys: number; sells: number }
        h1: { buys: number; sells: number }
        h6: { buys: number; sells: number }
        h24: { buys: number; sells: number }
    }
    volume: {
        h24: number
        h6: number
        h1: number
        m5: number
    }
    priceChange: {
        m5: number
        h1: number
        h6: number
        h24: number
    }
    liquidity: {
        usd: number
        base: number
        quote: number
    }
}

export interface DexScreenerSearchResponse {
    schemaVersion: string
    pairs: DexScreenerPair[]
}

/**
 * Search/import tokens for a specific chain.
 *
 * - Pasted contract address → authoritative on-chain metadata for the SELECTED
 *   chain via /token (works on every supported chain, incl. Base/Incentiv,
 *   regardless of DexScreener coverage).
 * - Name/symbol query → DexScreener search, filtered to the active chain and
 *   tagged with the correct chainId; decimals backfilled on-chain (DexScreener
 *   doesn't return decimals).
 *
 * Imported tokens always carry the active chain's chainId so they match the
 * chain's token list and swap correctly.
 */
export async function searchTokens(query: string, chain: ChainKey, chainId: number): Promise<Token[]> {
    const q = query.trim()
    if (!q) return []

    const slug = DEXSCREENER_SLUG[chain]

    // Paste-an-address: resolve on-chain for the active chain.
    if (isAddress(q)) {
        try {
            const address = getAddress(q)
            const { token } = await fetchTokenMetadata({ chain, address })
            return [{
                address,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                chainId,
                logoURI: logoUrl(slug, address),
                isImported: true,
            }]
        } catch {
            return []
        }
    }

    // Name/symbol search needs DexScreener; chains without coverage return empty
    // (users import those by pasting an address instead).
    if (!slug) return []

    try {
        const response = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(q)}`)
        if (!response.ok) {
            throw new Error('Failed to fetch from DexScreener')
        }
        const data: DexScreenerSearchResponse = await response.json()

        const seen = new Set<string>()
        const tokens: Token[] = []
        for (const pair of data.pairs ?? []) {
            if (pair.chainId !== slug) continue // only the active chain
            const key = pair.baseToken.address.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            tokens.push({
                address: pair.baseToken.address,
                symbol: pair.baseToken.symbol,
                name: pair.baseToken.name,
                decimals: 18, // placeholder; backfilled below
                chainId,
                logoURI: logoUrl(slug, pair.baseToken.address),
                isImported: true,
            })
            if (tokens.length >= 12) break
        }
        if (tokens.length === 0) return []

        // DexScreener omits decimals — fetch the real value on-chain so amounts
        // are correct. Best-effort; falls back to 18 on failure.
        const meta = await Promise.allSettled(
            tokens.map((t) => fetchTokenMetadata({ chain, address: t.address })),
        )
        meta.forEach((r, i) => {
            if (r.status === 'fulfilled') tokens[i].decimals = r.value.token.decimals
        })

        return tokens
    } catch (error) {
        console.error('DexScreener search error:', error)
        return []
    }
}
