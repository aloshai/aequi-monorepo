import { getAddress, type Address } from 'viem'
import type { ChainKey, TokenMetadata } from '@aequi/core'
import { Q18 } from '@aequi/pricing'
import { appConfig } from './app-config'

export { Q18 }

export const DEFAULT_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export const MIN_V2_RESERVE_THRESHOLD = 10n ** 15n // Filter dust pairs with near-zero reserves
export const MIN_V3_LIQUIDITY_THRESHOLD = 1000n // Skip ultra-low liquidity V3 pools

export const NATIVE_ADDRESS = '0xEeeeeEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export const INTERMEDIATE_TOKENS: Record<ChainKey, Array<Omit<TokenMetadata, 'totalSupply'>>> = {
  ethereum: [
    {
      chainId: 1,
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    {
      chainId: 1,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eb48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    {
      chainId: 1,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
    },
    {
      chainId: 1,
      address: '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
      symbol: 'BUSD',
      name: 'Binance USD',
      decimals: 18,
    },
    {
      chainId: 1,
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      symbol: 'DAI',
      name: 'Dai Stablecoin',
      decimals: 18,
    },
    {
      chainId: 1,
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      name: 'Wrapped BTC',
      decimals: 8,
    },
  ],
  bsc: [
    {
      chainId: 56,
      address: '0xBB4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      symbol: 'WBNB',
      name: 'Wrapped BNB',
      decimals: 18,
    },
    {
      chainId: 56,
      address: '0x55d398326f99059fF775485246999027B3197955',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 18,
    },
    {
      chainId: 56,
      address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 18,
    },
    {
      chainId: 56,
      address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
      symbol: 'BUSD',
      name: 'Binance USD',
      decimals: 18,
    },
    {
      chainId: 56,
      address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
      symbol: 'BTCB',
      name: 'BTCB Token',
      decimals: 18,
    },
    {
      chainId: 56,
      address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
      symbol: 'ETH',
      name: 'Binance-Peg Ethereum',
      decimals: 18,
    },
    {
      chainId: 56,
      address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      symbol: 'CAKE',
      name: 'PancakeSwap Token',
      decimals: 18,
    },
    {
      chainId: 56,
      address: '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409',
      symbol: 'FDUSD',
      name: 'First Digital USD',
      decimals: 18,
    },
  ],
}

export const INTERMEDIATE_TOKEN_ADDRESSES: Record<ChainKey, Address[]> = Object.fromEntries(
  Object.entries(INTERMEDIATE_TOKENS).map(([chain, tokens]) => [
    chain,
    tokens.map((t) => getAddress(t.address)),
  ]),
) as Record<ChainKey, Address[]>

export const AEQUI_EXECUTOR_ADDRESS: Record<ChainKey, Address | null> = {
  ethereum: appConfig.executor.eth,
  bsc: appConfig.executor.bsc,
}

export const EXECUTOR_INTERHOP_BUFFER_BPS = appConfig.executor.interhopBufferBps

export const SWAP_QUOTE_TTL_SECONDS = appConfig.swap.quoteTtlSeconds
