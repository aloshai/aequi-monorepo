import { mainnet, bsc as bscChain } from 'viem/chains'
import { defineChain } from 'viem'
import type { ChainConfig, ChainKey } from '../types'
import { FeeAmount as PancakeFeeAmount } from '@pancakeswap/v3-sdk'
import { FeeAmount } from '@uniswap/v3-sdk'
import { appConfig } from './app-config'

const incentivChain = defineChain({
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

const inkChain = defineChain({
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

const buildSettlerAddresses = (key: ChainKey) => ({
    settler: appConfig.settler.byChain[key].settler,
    settlerMetaTxn: appConfig.settler.byChain[key].settlerMetaTxn,
    allowanceHolder: appConfig.settler.allowanceHolder,
    permit2: appConfig.settler.permit2,
})

export const CHAIN_CONFIGS: Record<ChainKey, ChainConfig> = {
    ethereum: {
        key: 'ethereum',
        id: mainnet.id,
        name: 'Ethereum',
        nativeCurrencySymbol: mainnet.nativeCurrency.symbol,
        wrappedNativeAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        rpcUrls: appConfig.rpc.ethereum.length ? appConfig.rpc.ethereum : Array.from(mainnet.rpcUrls.default.http),
        fallbackRpcUrls: appConfig.rpc.ethereumFallback,
        disablePublicRpcRegistry: appConfig.rpc.ethereum.length > 0,
        viemChain: mainnet,
        settler: buildSettlerAddresses('ethereum'),
        dexes: [
            {
                id: 'uniswap-v2',
                label: 'Uniswap V2',
                protocol: 'uniswap',
                version: 'v2',
                factoryAddress: appConfig.dex.uniswapV2Factory,
                routerAddress: appConfig.dex.uniswapV2Router,
            },
            {
                id: 'uniswap-v3',
                label: 'Uniswap V3',
                protocol: 'uniswap',
                version: 'v3',
                factoryAddress: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
                routerAddress: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
                quoterAddress: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
                feeTiers: [FeeAmount.LOWEST, FeeAmount.LOW_200, FeeAmount.LOW_300, FeeAmount.LOW_400, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH],
                useRouter02: true, // Uniswap V3 uses Router02 (no deadline in struct)
            },
            {
                // Uniswap V4 on Ethereum mainnet. Singleton PoolManager;
                // routerAddress equals factoryAddress (V4 has no router —
                // Settler talks directly to PoolManager via the UNISWAPV4 action).
                // Standard fee/tickSpacing combinations covered:
                //   100 / 1   (stable-stable)
                //   500 / 10  (stable-volatile)
                //   3000 / 60 (volatile)
                //   10000/200 (exotic)
                id: 'uniswap-v4',
                label: 'Uniswap V4',
                protocol: 'uniswap',
                version: 'v4',
                factoryAddress: '0x000000000004444c5dc75cB358380D2e3dE08A90', // PoolManager
                routerAddress: '0x000000000004444c5dc75cB358380D2e3dE08A90', // No router on V4
                quoterAddress: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
                feeTiers: [100, 500, 3000, 10000],
                v4TickSpacings: [[100, 1], [500, 10], [3000, 60], [10000, 200]],
            },
        ],
    },
    bsc: {
        key: 'bsc',
        id: bscChain.id,
        name: 'BNB Smart Chain',
        nativeCurrencySymbol: bscChain.nativeCurrency.symbol,
        wrappedNativeAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        rpcUrls: (() => {
            if (appConfig.rpc.bsc.length) {
                return appConfig.rpc.bsc
            }
            const defaults = bscChain.rpcUrls.default?.http ?? []
            return defaults.length ? Array.from(defaults) : ['https://bsc.drpc.org']
        })(),
        fallbackRpcUrls: appConfig.rpc.bscFallback,
        disablePublicRpcRegistry: appConfig.rpc.bsc.length > 0,
        viemChain: bscChain,
        settler: buildSettlerAddresses('bsc'),
        dexes: [
            {
                id: 'pancake-v2',
                label: 'PancakeSwap V2',
                protocol: 'pancakeswap',
                version: 'v2',
                factoryAddress: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
                routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
            },
            {
                id: 'pancake-v3',
                label: 'PancakeSwap V3',
                protocol: 'pancakeswap',
                version: 'v3',
                factoryAddress: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865',
                routerAddress: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
                quoterAddress: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997',
                feeTiers: [PancakeFeeAmount.LOWEST, PancakeFeeAmount.LOW, PancakeFeeAmount.MEDIUM, PancakeFeeAmount.HIGH],
                useRouter02: false, // PancakeSwap V3 uses standard router with deadline in struct
            },
            {
                id: "uniswap-v2",
                label: "Uniswap V2",
                protocol: "uniswap",
                version: "v2",
                factoryAddress: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
                routerAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
            },
            {
                id: "uniswap-v3",
                label: "Uniswap V3",
                protocol: "uniswap",
                version: "v3",
                factoryAddress: '0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7',
                routerAddress: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
                quoterAddress: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
                feeTiers: [FeeAmount.LOWEST, FeeAmount.LOW_200, FeeAmount.LOW_300, FeeAmount.LOW_400, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH],
                useRouter02: true, // Uniswap V3 uses Router02 (no deadline in struct)
            },
            {
                // Uniswap V4 on BNB Chain (chainId 56).
                id: 'uniswap-v4',
                label: 'Uniswap V4',
                protocol: 'uniswap',
                version: 'v4',
                factoryAddress: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF', // PoolManager
                routerAddress: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF',
                quoterAddress: '0x9F75dD27D6664c475B90e105573E550ff69437B0',
                feeTiers: [100, 500, 3000, 10000],
                v4TickSpacings: [[100, 1], [500, 10], [3000, 60], [10000, 200]],
            },
        ],
    },
    ink: {
        key: 'ink',
        id: inkChain.id,
        name: 'Ink',
        nativeCurrencySymbol: inkChain.nativeCurrency.symbol,
        wrappedNativeAddress: '0x4200000000000000000000000000000000000006',
        rpcUrls: appConfig.rpc.ink.length ? appConfig.rpc.ink : Array.from(inkChain.rpcUrls.default.http),
        fallbackRpcUrls: appConfig.rpc.inkFallback,
        disablePublicRpcRegistry: appConfig.rpc.ink.length > 0,
        viemChain: inkChain,
        settler: buildSettlerAddresses('ink'),
        dexes: [
            {
                // Uniswap V4 on Ink (officially deployed by Uniswap Labs Jan 28 2025).
                // V3 is *not* in Uniswap's official Ink manifest (community-deployed
                // Factory exists but no Quoter periphery).
                id: 'uniswap-v4',
                label: 'Uniswap V4',
                protocol: 'uniswap',
                version: 'v4',
                factoryAddress: '0x360e68faccca8ca495c1b759fd9eee466db9fb32', // PoolManager
                routerAddress: '0x360e68faccca8ca495c1b759fd9eee466db9fb32',
                quoterAddress: '0x3972c00f7ed4885e145823eb7c655375d275a1c5',
                feeTiers: [100, 500, 3000, 10000],
                v4TickSpacings: [[100, 1], [500, 10], [3000, 60], [10000, 200]],
            },
            {
                // Velodrome V3 (Slipstream) on Ink — the dominant DEX by volume
                // (DefiLlama: ~$1.8M/day vs Uniswap V4's ~$35/day).
                //
                // Settler routing: this DEX is dispatched via the standard
                // UNISWAPV3 action with forkId=4, but ONLY through Aequi's
                // forked Settler deployment on Ink (which wires forkId=4 to
                // Velodrome Ink's factory + EIP-1167 init hash). Upstream
                // 0x Settler does not include this on Ink; routing through
                // it would fail at pool-address derivation. Aequi's Settler
                // address for Ink (appConfig.settler.byChain.ink) must point
                // at the forked deployment for Velodrome routing to work.
                //
                // Pool addressing: tickSpacing-keyed (not fee), see the
                // slipstreamTickSpacings field below. Quoter ABI also uses
                // int24 tickSpacing instead of uint24 fee. The Velodrome
                // CL factory enables [1, 50, 100, 200, 2000] tickSpacings
                // mapping to fees [100, 500, 500, 3000, 10000] respectively.
                id: 'velodrome-slipstream',
                label: 'Velodrome V3 (Slipstream)',
                protocol: 'velodrome-slipstream',
                version: 'v3',
                factoryAddress: '0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F',
                routerAddress: '0x04625B046C69577EfC40e6c0Bb83CDBAfab5a55F', // No standalone router in our flow; Settler dispatches directly
                quoterAddress: '0x3FA596fAC2D6f7d16E01984897Ac04200Cb9cA05',
                slipstreamTickSpacings: [1, 50, 100, 200, 2000],
            },
        ],
    },
    incentiv: {
        key: 'incentiv',
        id: incentivChain.id,
        name: 'Incentiv',
        nativeCurrencySymbol: incentivChain.nativeCurrency.symbol,
        wrappedNativeAddress: '0xB0f0A14A50F14dc9e6476d61C00cF0375Dd4EB04',
        rpcUrls: appConfig.rpc.incentiv.length ? appConfig.rpc.incentiv : Array.from(incentivChain.rpcUrls.default.http),
        fallbackRpcUrls: appConfig.rpc.incentivFallback,
        disablePublicRpcRegistry: appConfig.rpc.incentiv.length > 0,
        viemChain: incentivChain,
        settler: buildSettlerAddresses('incentiv'),
        dexes: [
            {
                id: 'incentive-portal-v3',
                label: 'Incentive Portal V3',
                protocol: 'incentive-portal',
                version: 'v3',
                factoryAddress: '0x766A315502B1f9869C0E2A19aEA6D6f55b0ad108',
                routerAddress: '0x4a66A8bA9704DD06fE52A027f2B16a3F5D11B048',
                quoterAddress: '0x1d317fFfBc3Bda5aA06F9f8f506e8C6082dC415A',
                feeTiers: [FeeAmount.LOWEST, FeeAmount.LOW_200, FeeAmount.LOW_300, FeeAmount.LOW_400, FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH],
                useRouter02: false, // Incentive Portal uses standard V3 router with deadline in struct
            },
        ],
    },
}

export const SUPPORTED_CHAINS = Object.keys(CHAIN_CONFIGS) as ChainKey[]

export const getChainConfig = (chain: string): ChainConfig | null => {
    const key = chain.toLowerCase() as ChainKey
    return CHAIN_CONFIGS[key] ?? null
}
