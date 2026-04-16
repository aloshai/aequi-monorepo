import type { ChainKey } from '../types/api'

export interface TokenPreset {
  address: string
  symbol: string
  label: string
  decimals: number
}

export const tokenDirectory: Record<ChainKey, TokenPreset[]> = {
  ethereum: [
    {
      address: '0xEeeeeEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      symbol: 'ETH',
      label: 'ETH · Ether',
      decimals: 18,
    },
    {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      symbol: 'USDC',
      label: 'USDC · USD Coin',
      decimals: 6,
    },
    {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      symbol: 'USDT',
      label: 'USDT · Tether USD',
      decimals: 6,
    },
    {
      address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
      symbol: 'DAI',
      label: 'DAI · Dai Stablecoin',
      decimals: 18,
    },
    {
      address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
      symbol: 'WBTC',
      label: 'WBTC · Wrapped BTC',
      decimals: 8,
    },
  ],
  bsc: [
    {
      address: '0xEeeeeEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      symbol: 'BNB',
      label: 'BNB · Native BNB',
      decimals: 18,
    },
    {
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      symbol: 'WBNB',
      label: 'WBNB · Wrapped BNB',
      decimals: 18,
    },
    {
      address: '0x55d398326f99059fF775485246999027B3197955',
      symbol: 'USDT',
      label: 'USDT · Tether USD',
      decimals: 18,
    },
    {
      address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
      symbol: 'USDC',
      label: 'USDC · USD Coin',
      decimals: 18,
    },
    {
      address: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
      symbol: 'BUSD',
      label: 'BUSD · Binance USD',
      decimals: 18,
    },
    {
      address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
      symbol: 'DAI',
      label: 'DAI · Dai Stablecoin',
      decimals: 18,
    },
  ],
  incentiv: [
    {
      address: '0xEeeeeEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      symbol: 'CENT',
      label: 'CENT · Native CENT',
      decimals: 18,
    },
    {
      address: '0xB0f0A14A50F14dc9e6476d61C00cF0375Dd4EB04',
      symbol: 'WCENT',
      label: 'WCENT · Wrapped CENT',
      decimals: 18,
    },
    {
      address: '0x16e43840d8D79896A389a3De85aB0B0210C05685',
      symbol: 'USDC',
      label: 'USDC · USD Coin',
      decimals: 6,
    },
    {
      address: '0x39b076b5d23F588690D480af3Bf820edad31a4bB',
      symbol: 'USDT',
      label: 'USDT · Tether USD',
      decimals: 6,
    },
    {
      address: '0x3e425317dB7BaC8077093117081b40d9b46F29cb',
      symbol: 'WETH',
      label: 'WETH · Wrapped Ether',
      decimals: 18,
    },
    {
      address: '0xfaC24134dbc4b00Ee11114eCDFE6397f389203E3',
      symbol: 'SOL',
      label: 'SOL · Solana',
      decimals: 18,
    },
    {
      address: '0x0292593D416Cb765E0e8FF77b32fA7e465958FEE',
      symbol: 'WBTC',
      label: 'WBTC · Wrapped BTC',
      decimals: 8,
    },
  ],
}
