import { createConfig, http } from 'wagmi'
import { bsc, mainnet } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'
import { defineChain } from 'viem'

const incentiv = defineChain({
  id: 24101,
  name: 'Incentiv',
  nativeCurrency: { name: 'CENT', symbol: 'CENT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.incentiv.io'] },
  },
  blockExplorers: {
    default: { name: 'Incentiv Explorer', url: 'https://explorer.incentiv.io' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
})

const ink = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel.inkonchain.com'] },
  },
  blockExplorers: {
    default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
})

export const wagmiConfig = createConfig({
  chains: [mainnet, bsc, incentiv, ink],
  connectors: [metaMask(), injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(),
    [bsc.id]: http(),
    [incentiv.id]: http(),
    [ink.id]: http(),
  },
  ssr: false,
})

export const CHAIN_BY_KEY = {
  ethereum: mainnet,
  bsc,
  incentiv,
  ink,
} as const

export type SupportedChainKey = keyof typeof CHAIN_BY_KEY
