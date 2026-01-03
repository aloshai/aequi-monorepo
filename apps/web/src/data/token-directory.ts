import type { ChainKey } from '../types/api'

export interface TokenPreset {
  address: string
  symbol: string
  label: string
}

export const tokenDirectory: Record<ChainKey, TokenPreset[]> = {
  ethereum: [
    {
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      symbol: 'ETH',
      label: 'ETH · Ether',
    },
    {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      label: 'USDC · USD Coin',
    },
    {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      label: 'USDT · Tether USD',
    },
    {
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      symbol: 'DAI',
      label: 'DAI · Dai Stablecoin',
    },
    {
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      label: 'WBTC · Wrapped BTC',
    },
  ],
  bsc: [
    {
      address: '0xEeeeeEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      symbol: 'BNB',
      label: 'BNB · Native BNB',
    },
    {
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      symbol: 'WBNB',
      label: 'WBNB · Wrapped BNB',
    },
    {
      address: '0x55d398326f99059fF775485246999027B3197955',
      symbol: 'USDT',
      label: 'USDT · Tether USD',
    },
    {
      address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
      symbol: 'USDC',
      label: 'USDC · USD Coin',
    },
    {
      address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
      symbol: 'BUSD',
      label: 'BUSD · Binance USD',
    },
    {
      address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
      symbol: 'DAI',
      label: 'DAI · Dai Stablecoin',
    },
  ],
}
