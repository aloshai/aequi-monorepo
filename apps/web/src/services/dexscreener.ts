import type { Token } from './token-manager'
import { fetchTokenMetadata } from './aequi-api'
import type { ChainKey } from '../types/api'

const BASE_URL = 'https://api.dexscreener.com/latest/dex'

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

export async function searchTokens(query: string): Promise<Token[]> {
    try {
        const response = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}`)
        if (!response.ok) {
            throw new Error('Failed to fetch from DexScreener')
        }
        const data: DexScreenerSearchResponse = await response.json()

        const tokensMap = new Map<string, { pair: DexScreenerPair; chain: ChainKey; chainId: number }>()

        if (data.pairs) {
            for (const pair of data.pairs) {
                const key = pair.baseToken.address.toLowerCase()
                if (!tokensMap.has(key)) {
                    const chain: ChainKey = pair.chainId === 'bsc' ? 'bsc' : 'ethereum'
                    const chainId = pair.chainId === 'bsc' ? 56 : 1
                    tokensMap.set(key, { pair, chain, chainId })
                }
            }
        }

        const entries = Array.from(tokensMap.values())
        if (entries.length === 0) return []

        const metadataResults = await Promise.allSettled(
            entries.map(({ chain, pair }) =>
                fetchTokenMetadata({ chain, address: pair.baseToken.address })
            )
        )

        return entries.map(({ pair, chain, chainId }, idx) => {
            const result = metadataResults[idx]
            const decimals = result?.status === 'fulfilled' ? result.value.token.decimals : 18

            return {
                address: pair.baseToken.address,
                symbol: pair.baseToken.symbol,
                name: pair.baseToken.name,
                decimals,
                chainId,
                logoURI: `https://dd.dexscreener.com/ds-data/tokens/${chain === 'bsc' ? 'bsc' : pair.chainId}/${pair.baseToken.address}.png`,
                isImported: true,
            }
        })
    } catch (error) {
        console.error('DexScreener search error:', error)
        return []
    }
}
