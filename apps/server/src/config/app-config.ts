import { getAddress } from 'viem'
import type { Address } from 'viem'

const parseUrlList = (value: string | undefined): string[] =>
  value?.split(',').map((url) => url.trim()).filter(Boolean) ?? []

const parseAddressOrNull = (value: string | undefined): Address | null => {
  if (!value) {
    return null
  }
  try {
    return getAddress(value)
  } catch (error) {
    console.warn(`[config] invalid address '${value}':`, (error as Error).message)
    return null
  }
}

const parseAddressWithFallback = (value: string | undefined, fallback: Address): Address => {
  const parsed = parseAddressOrNull(value)
  return parsed ?? fallback
}

const parseIntWithDefault = (value: string | undefined, fallback: number, min: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  if (parsed < min) {
    return fallback
  }
  return parsed
}

const DEFAULTS = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    rateLimitMax: 120,
    rateLimitWindow: '1 minute',
  },
  executor: {
    interhopBufferBps: 10,
    quoteTtlSeconds: 15,
    bscAddress: '0x03cbBc27784c64FC4A6f11eFe8D1C3b4Dee204EA' as Address,
    incentivAddress: '0xD48074f8971E6E7FD0981a710FA7Fe5d0baA64ae' as Address,
  },
  dex: {
    uniswapV2Factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f' as Address,
    uniswapV2Router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address,
  },
  // 0x Settler infrastructure. AllowanceHolder + Permit2 are identical across
  // all EVM chains by deterministic deployment. Settler / SettlerMetaTxn
  // addresses are per-chain and *change* whenever 0x deploys a new Settler
  // version on that chain. They are resolved by calling the 0x Deployer
  // contract's `ownerOf(tokenId)` view (tokenId 2 = Settler / taker-submitted,
  // tokenId 3 = SettlerMetaTxn). Do NOT use Deployer.next() — that returns the
  // *predicted* CREATE2 address of the *next* deployment, which has no code
  // until 0x actually deploys it.
  //
  // Deployer address (identical across chains): 0x00000000000004533Fe15556B1E086BB1A72cEae
  //
  // To re-resolve on demand:
  //   const settlerAddr = await publicClient.readContract({
  //     address: DEPLOYER,
  //     abi: [{ type: 'function', name: 'ownerOf', stateMutability: 'view',
  //             inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] }],
  //     functionName: 'ownerOf',
  //     args: [2n],  // or 3n for MetaTxn
  //   })
  //
  // Resolved 2026-05-26 against ethereum-rpc.publicnode.com + bsc-dataseed.binance.org.
  // Incentiv stays null until a Settler fork is deployed there.
  settler: {
    allowanceHolder: '0x0000000000001fF3684f28c67538d4D072C22734' as Address,
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address,
    ethSettler: '0x7f54F05635d15Cde17A49502fEdB9D1803A3Be8A' as Address,
    ethSettlerMetaTxn: '0x0476C2483f4c6AA4Dfb6EFA29815AB74d9C1e508' as Address,
    bscSettler: '0xc2eff1F1cE35d395408A34Ad881dBCD978F40b89' as Address,
    bscSettlerMetaTxn: '0xFffdb7DBAEaf3138B7cfc2328c21f9343C1f7faA' as Address,
  },
}

const NODE_ENV = process.env.NODE_ENV ?? 'development'

export const appConfig = {
  env: NODE_ENV,
  server: {
    port: parseIntWithDefault(process.env.PORT, DEFAULTS.server.port, 1),
    host: process.env.HOST ?? DEFAULTS.server.host,
    loggerEnabled: NODE_ENV !== 'test',
  },
  rateLimit: {
    max: parseIntWithDefault(process.env.RATE_LIMIT_MAX, DEFAULTS.server.rateLimitMax, 1),
    window: process.env.RATE_LIMIT_WINDOW ?? DEFAULTS.server.rateLimitWindow,
  },
  rpc: {
    ethereum: parseUrlList(process.env.RPC_URL_ETH),
    ethereumFallback: parseUrlList(process.env.RPC_URL_ETH_FALLBACK),
    bsc: parseUrlList(process.env.BSC_RPC_URL),
    bscFallback: parseUrlList(process.env.BSC_RPC_URL_FALLBACK),
    incentiv: parseUrlList(process.env.INCENTIV_RPC_URL),
    incentivFallback: parseUrlList(process.env.INCENTIV_RPC_URL_FALLBACK),
  },
  dex: {
    uniswapV2Factory: parseAddressWithFallback(process.env.UNISWAP_V2_FACTORY, DEFAULTS.dex.uniswapV2Factory),
    uniswapV2Router: parseAddressWithFallback(process.env.UNISWAP_V2_ROUTER, DEFAULTS.dex.uniswapV2Router),
  },
  executor: {
    eth: parseAddressOrNull(process.env.AEQUI_EXECUTOR_ETH),
    bsc: parseAddressOrNull(process.env.AEQUI_EXECUTOR_BSC) ?? DEFAULTS.executor.bscAddress,
    incentiv: parseAddressOrNull(process.env.AEQUI_EXECUTOR_INCENTIV) ?? DEFAULTS.executor.incentivAddress,
    interhopBufferBps: parseIntWithDefault(process.env.EXECUTOR_INTERHOP_BUFFER_BPS, DEFAULTS.executor.interhopBufferBps, 0),
  },
  swap: {
    quoteTtlSeconds: parseIntWithDefault(process.env.SWAP_QUOTE_TTL_SECONDS, DEFAULTS.executor.quoteTtlSeconds, 1),
  },
  routing: {
    maxHopDepth: Math.min(parseIntWithDefault(process.env.MAX_HOP_DEPTH, 2, 1), 4),
    enableSplitRouting: process.env.ENABLE_SPLIT_ROUTING !== 'false',
    maxSplitLegs: Math.min(parseIntWithDefault(process.env.MAX_SPLIT_LEGS, 20, 2), 20),
    splitConvergenceThresholdBps: parseIntWithDefault(process.env.SPLIT_CONVERGENCE_THRESHOLD_BPS, 10, 1),
    splitMaxIterations: parseIntWithDefault(process.env.SPLIT_MAX_ITERATIONS, 100, 5),
    splitMinLegRatioBps: parseIntWithDefault(process.env.SPLIT_MIN_LEG_RATIO_BPS, 50, 10),
  },
  fee: {
    bps: parseIntWithDefault(process.env.FEE_BPS, 30, 0),
    // Settler's POSITIVE_SLIPPAGE action requires a non-zero recipient. Until
    // a real fee wallet is set via FEE_RECIPIENT, we use the zero address —
    // SettlerBackend treats fee=null when this is the case (no fee skim).
    recipient: parseAddressOrNull(process.env.FEE_RECIPIENT),
  },
  settler: {
    allowanceHolder: getAddress(DEFAULTS.settler.allowanceHolder),
    permit2: getAddress(DEFAULTS.settler.permit2),
    byChain: {
      ethereum: {
        settler: parseAddressOrNull(process.env.SETTLER_ETH) ?? DEFAULTS.settler.ethSettler,
        settlerMetaTxn: parseAddressOrNull(process.env.SETTLER_META_TXN_ETH) ?? DEFAULTS.settler.ethSettlerMetaTxn,
      },
      bsc: {
        settler: parseAddressOrNull(process.env.SETTLER_BSC) ?? DEFAULTS.settler.bscSettler,
        settlerMetaTxn: parseAddressOrNull(process.env.SETTLER_META_TXN_BSC) ?? DEFAULTS.settler.bscSettlerMetaTxn,
      },
      incentiv: {
        // Settler is not deployed on Incentiv yet. Plan 1 deferred this work;
        // see docs/superpowers/plans/2026-05-26-plan-1-settler-infrastructure-NOTES.md.
        settler: parseAddressOrNull(process.env.SETTLER_INCENTIV),
        settlerMetaTxn: parseAddressOrNull(process.env.SETTLER_META_TXN_INCENTIV),
      },
    },
  },
} as const

export type AppConfig = typeof appConfig
