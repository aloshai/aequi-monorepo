import { createConfig, http } from 'wagmi'
import { bsc, mainnet } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

export const wagmiConfig = createConfig({
  chains: [mainnet, bsc],
  connectors: [metaMask(), injected({ shimDisconnect: true })],
  transports: {
    [mainnet.id]: http(),
    [bsc.id]: http(),
  },
  ssr: false,
})

export const CHAIN_BY_KEY = {
  ethereum: mainnet,
  bsc,
} as const

export type SupportedChainKey = keyof typeof CHAIN_BY_KEY
