import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { z } from 'zod'
import { isAddress, encodeAbiParameters, keccak256, pad, toHex } from 'viem'
import type { Address, Hex } from 'viem'
import { validateEnv } from './config/env'
import { getChainConfig, SUPPORTED_CHAINS } from './config/chains'
import {
    AEQUI_EXECUTOR_ADDRESS,
    EXECUTOR_INTERHOP_BUFFER_BPS,
    SWAP_QUOTE_TTL_SECONDS,
    INTERMEDIATE_TOKENS,
    INTERMEDIATE_TOKEN_ADDRESSES,
    MIN_V2_RESERVE_THRESHOLD,
    MIN_V3_LIQUIDITY_THRESHOLD,
    NATIVE_ADDRESS,
} from './config/constants'
import { appConfig } from './config/app-config'
import { ExchangeService } from './services/exchange/exchange-service'
import { TokenService, PriceService, PoolDiscovery } from '@aequi/pricing'
import { registerDefaultAdapters } from '@aequi/dex-adapters'
import { errorHandler } from './middleware/error-handler'
import { requestIdHook } from './middleware/request-id'
import { loggerConfig } from './config/logger'
import { QuoteService } from './services/quote/quote-service'
import { AllowanceService } from './services/tokens/allowance-service'
import { SwapBuilder } from '@aequi/core'
import { formatAmountFromUnits, parseAmountToUnits } from './utils/units'
import { DefaultChainClientProvider } from './services/clients/default-chain-client-provider'
import { normalizeAddress } from './utils/trading'
import { HealthService } from './services/health/health-service'
import { TtlCache } from './utils/ttl-cache'
import { QuoteStore } from './utils/quote-store'
import { decodeRevertReason } from './utils/revert-decoder'
import type { ChainConfig, PriceQuote, QuoteResult, RoutePreference, TokenMetadata } from './types'

// Register default DEX adapters
registerDefaultAdapters()

const chainClientProvider = new DefaultChainClientProvider()
const exchangeService = new ExchangeService()
const tokenService = new TokenService(chainClientProvider, { preloadTokens: INTERMEDIATE_TOKENS })
const poolDiscovery = new PoolDiscovery(tokenService, chainClientProvider, {
    intermediateTokenAddresses: INTERMEDIATE_TOKEN_ADDRESSES,
    minV2ReserveThreshold: MIN_V2_RESERVE_THRESHOLD,
    minV3LiquidityThreshold: MIN_V3_LIQUIDITY_THRESHOLD,
    maxHopDepth: appConfig.routing.maxHopDepth,
})
const priceService = new PriceService(tokenService, chainClientProvider, poolDiscovery,
    appConfig.routing.enableSplitRouting ? {
        maxSplitLegs: appConfig.routing.maxSplitLegs,
        convergenceThresholdBps: appConfig.routing.splitConvergenceThresholdBps,
        maxIterations: appConfig.routing.splitMaxIterations,
        minLegRatioBps: appConfig.routing.splitMinLegRatioBps,
    } : null,
)
const quoteService = new QuoteService(tokenService, priceService)
const quoteCache = new TtlCache<QuoteResult>(5_000)
const quoteStore = new QuoteStore(SWAP_QUOTE_TTL_SECONDS * 1000)
const allowanceService = new AllowanceService(tokenService, chainClientProvider)
const swapBuilder = new SwapBuilder({
    executorByChain: AEQUI_EXECUTOR_ADDRESS,
    interhopBufferBps: EXECUTOR_INTERHOP_BUFFER_BPS,
})
const healthService = new HealthService()

const chainQuerySchema = z.object({
    chain: z.string().min(1),
})
const resolveRoutePreference = (value?: string): RoutePreference => {
    if (!value) {
        return 'auto'
    }
    const normalized = value.toLowerCase()
    if (normalized === 'v2' || normalized === 'v3') {
        return normalized
    }
    if (normalized === 'auto') {
        return 'auto'
    }
    return 'auto'
}

const resolveChain = (chainParam: string) => {
    const chain = getChainConfig(chainParam)
    if (!chain) {
        throw new Error(`Unsupported chain '${chainParam}'. Supported chains: ${SUPPORTED_CHAINS.join(', ')}`)
    }

    return chain
}

const formatPriceQuote = (chain: ChainConfig, quote: PriceQuote, routePreference: RoutePreference): any => {
    const tokenIn = quote.path[0]!
    const tokenOut = quote.path[quote.path.length - 1]!

    const pathSymbols = quote.path.map((token) => token.symbol ?? token.address)
    const tokenPath = quote.path.map((token) => ({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
    }))

    const pools = quote.sources.map((source) => ({
        dexId: source.dexId,
        poolAddress: source.poolAddress,
        feeTier: source.feeTier ?? null,
    }))

    const sourceLabel = pools
        .map((source) => (source.feeTier ? `${source.dexId}@${source.feeTier}` : source.dexId))
        .join(' > ')

    const sources = quote.sources.map((source) => ({
        dexId: source.dexId,
        poolAddress: source.poolAddress,
        feeTier: source.feeTier,
        amountIn: source.amountIn.toString(),
        amountOut: source.amountOut.toString(),
        reserves: source.reserves ? {
            reserve0: source.reserves.reserve0?.toString(),
            reserve1: source.reserves.reserve1?.toString(),
            liquidity: source.reserves.liquidity?.toString(),
            sqrtPriceX96: source.reserves.sqrtPriceX96?.toString(),
            tick: source.reserves.tick,
            token0: source.reserves.token0,
            token1: source.reserves.token1,
        } : undefined
    }))

    const amountInFormatted = formatAmountFromUnits(quote.amountIn, tokenIn.decimals)
    const amountOutFormatted = formatAmountFromUnits(quote.amountOut, tokenOut.decimals)

    const offers = quote.offers?.map(offer => formatPriceQuote(chain, offer, routePreference))

    return {
        chain: chain.key,
        source: sourceLabel,
        path: pathSymbols,
        tokens: tokenPath,
        routeAddresses: quote.routeAddresses,
        priceQ18: quote.priceQ18.toString(),
        midPriceQ18: quote.midPriceQ18.toString(),
        executionPriceQ18: quote.executionPriceQ18.toString(),
        priceImpactBps: quote.priceImpactBps,
        amountIn: quote.amountIn.toString(),
        amountInFormatted,
        amountOut: quote.amountOut.toString(),
        amountOutFormatted,
        liquidityScore: quote.liquidityScore.toString(),
        estimatedGasUnits: quote.estimatedGasUnits ? quote.estimatedGasUnits.toString() : null,
        estimatedGasCostWei: quote.estimatedGasCostWei ? quote.estimatedGasCostWei.toString() : null,
        gasPriceWei: quote.gasPriceWei ? quote.gasPriceWei.toString() : null,
        hopVersions: quote.hopVersions,
        routePreference,
        pools,
        sources,
        offers,
        ...(quote.isSplit && quote.splits ? {
            isSplit: true,
            splits: quote.splits.map((leg) => ({
                ratioBps: leg.ratioBps,
                quote: formatPriceQuote(chain, leg.quote, routePreference),
            })),
        } : {}),
    }
}
const COMMON_BALANCE_BASE_SLOTS = [0n, 2n, 3n, 51n, 101n]

function buildSimulationOverrides(
    holder: Address,
    inputToken: Address | null,
    spender: Address,
    amountIn: bigint,
) {
    const overrides: Array<{ address: Address; balance?: bigint; stateDiff?: Array<{ slot: Hex; value: Hex }> }> = [
        { address: holder, balance: 10n ** 24n },
    ]

    if (!inputToken) return overrides

    const balanceValue = pad(toHex(amountIn * 10n), { size: 32 })
    const maxAllowance = pad(toHex(2n ** 256n - 1n), { size: 32 })
    const diffs: Array<{ slot: Hex; value: Hex }> = []

    for (const baseSlot of COMMON_BALANCE_BASE_SLOTS) {
        diffs.push({
            slot: keccak256(encodeAbiParameters(
                [{ type: 'address' }, { type: 'uint256' }],
                [holder, baseSlot],
            )),
            value: balanceValue,
        })

        const innerHash = keccak256(encodeAbiParameters(
            [{ type: 'address' }, { type: 'uint256' }],
            [holder, baseSlot + 1n],
        ))
        diffs.push({
            slot: keccak256(encodeAbiParameters(
                [{ type: 'address' }, { type: 'bytes32' }],
                [spender, innerHash],
            )),
            value: maxAllowance,
        })
    }

    overrides.push({ address: inputToken, stateDiff: diffs })
    return overrides
}

export const buildServer = async () => {
    const app = Fastify({
        logger: appConfig.server.loggerEnabled ? loggerConfig : false,
    })

    app.addHook('onRequest', requestIdHook)

    const allowedOrigins = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
        : true
    await app.register(cors, { origin: allowedOrigins })
    await app.register(rateLimit, {
        max: appConfig.rateLimit.max,
        timeWindow: appConfig.rateLimit.window,
    })

    // Health check endpoints
    app.get('/health', async (request, reply) => {
        return healthService.handleHealthCheck(request, reply)
    })

    app.get('/health/live', async (request, reply) => {
        return healthService.handleLivenessCheck(request, reply)
    })

    app.get('/health/ready', async (request, reply) => {
        return healthService.handleReadinessCheck(request, reply)
    })

    app.get('/exchange', async (request, reply) => {
        const parsed = chainQuerySchema.safeParse(request.query)
        if (!parsed.success) {
            reply.status(400)
            return { error: 'invalid_request', details: parsed.error.flatten() }
        }

        let chain
        try {
            chain = resolveChain(parsed.data.chain)
        } catch (error) {
            reply.status(400)
            return { error: 'unsupported_chain', message: (error as Error).message }
        }

        const dexes = exchangeService.listDexes(chain).map((dex) => ({
            id: dex.id,
            label: dex.label,
            protocol: dex.protocol,
            version: dex.version,
            factoryAddress: dex.factoryAddress,
            routerAddress: dex.routerAddress,
            feeTiers: dex.feeTiers ?? [],
        }))

        return {
            chain: chain.key,
            dexes,
        }
    })

    app.get('/token', async (request, reply) => {
        const querySchema = chainQuerySchema.extend({
            address: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid address'),
        })

        const parsed = querySchema.safeParse(request.query)
        if (!parsed.success) {
            reply.status(400)
            return { error: 'invalid_request', details: parsed.error.flatten() }
        }

        let chain
        try {
            chain = resolveChain(parsed.data.chain)
        } catch (error) {
            reply.status(400)
            return { error: 'unsupported_chain', message: (error as Error).message }
        }

        const address = normalizeAddress(parsed.data.address).toLowerCase() as Address
        const token = await tokenService.getTokenMetadata(chain, address)

        return {
            chain: chain.key,
            token: {
                address: token.address,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                totalSupply: token.totalSupply ? token.totalSupply.toString() : null,
            },
        }
    })

    app.get('/allowance', async (request, reply) => {
        const querySchema = chainQuerySchema.extend({
            owner: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid owner address'),
            spender: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid spender address'),
            tokens: z.string().min(1, 'tokens query parameter is required'),
        })

        const parsed = querySchema.safeParse(request.query)
        if (!parsed.success) {
            reply.status(400)
            return { error: 'invalid_request', details: parsed.error.flatten() }
        }

        let chain
        try {
            chain = resolveChain(parsed.data.chain)
        } catch (error) {
            reply.status(400)
            return { error: 'unsupported_chain', message: (error as Error).message }
        }

        const owner = normalizeAddress(parsed.data.owner).toLowerCase() as Address
        const spender = normalizeAddress(parsed.data.spender).toLowerCase() as Address
        const tokenList = Array.from(
            new Set(
                parsed.data.tokens
                    .split(',')
                    .map((token) => token.trim())
                    .filter(Boolean)
                    .map((token) => normalizeAddress(token).toLowerCase() as Address),
            ),
        )

        if (!tokenList.length) {
            reply.status(400)
            return { error: 'invalid_request', message: 'tokens query parameter must include at least one token address' }
        }

        const allowances = await allowanceService.getAllowances(chain, owner, spender, tokenList)

        return {
            chain: chain.key,
            owner,
            spender,
            allowances: allowances.map((entry) => ({
                token: entry.token,
                allowance: entry.allowance.toString(),
            })),
        }
    })

    app.post('/approve', async (request, reply) => {
        const bodySchema = z.object({
            chain: z.string().min(1),
            token: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid token address'),
            spender: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid spender address'),
            amount: z.string().optional(),
            infinite: z.boolean().optional(),
        })

        const parsed = bodySchema.safeParse(request.body)
        if (!parsed.success) {
            reply.status(400)
            return { error: 'invalid_request', details: parsed.error.flatten() }
        }

        let chain
        try {
            chain = resolveChain(parsed.data.chain)
        } catch (error) {
            reply.status(400)
            return { error: 'unsupported_chain', message: (error as Error).message }
        }

        const token = normalizeAddress(parsed.data.token).toLowerCase() as Address
        const spender = normalizeAddress(parsed.data.spender).toLowerCase() as Address
        const amountInput = parsed.data.infinite ? 'max' : parsed.data.amount ?? null

        const result = await allowanceService.buildApproveCalldata(chain, token, spender, amountInput)

        return {
            chain: chain.key,
            token: result.token,
            spender: result.spender,
            amount: result.amount.toString(),
            decimals: result.decimals,
            callData: result.callData,
            transaction: {
                to: result.transaction.to,
                data: result.transaction.data,
                value: result.transaction.value.toString(),
            },
        }
    })

    app.get('/price', async (request, reply) => {
        const querySchema = chainQuerySchema.extend({
            tokenA: z.string().refine((value) => isAddress(value, { strict: false }) || value.toLowerCase() === NATIVE_ADDRESS.toLowerCase(), 'Invalid tokenA address'),
            tokenB: z.string().refine((value) => isAddress(value, { strict: false }) || value.toLowerCase() === NATIVE_ADDRESS.toLowerCase(), 'Invalid tokenB address'),
            amount: z.string().optional(),
            version: z.enum(['auto', 'v2', 'v3']).optional(),
            forceMultiHop: z.enum(['true', 'false']).optional(),
            enableSplit: z.enum(['true', 'false']).optional(),
        })

        const parsed = querySchema.safeParse(request.query)
        if (!parsed.success) {
            reply.status(400)
            return { error: 'invalid_request', details: parsed.error.flatten() }
        }

        let chain
        try {
            chain = resolveChain(parsed.data.chain)
        } catch (error) {
            reply.status(400)
            return { error: 'unsupported_chain', message: (error as Error).message }
        }

        const tokenA = normalizeAddress(parsed.data.tokenA).toLowerCase() as Address
        const tokenB = normalizeAddress(parsed.data.tokenB).toLowerCase() as Address
        const routePreference = resolveRoutePreference(parsed.data.version)
        const forceMultiHop = parsed.data.forceMultiHop === 'true'
        const enableSplit = parsed.data.enableSplit !== 'false'

        if (tokenA === tokenB) {
            reply.status(400)
            return { error: 'invalid_request', message: 'tokenA and tokenB must be different' }
        }

        const isNativeAddress = (addr: string) => addr.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
        const effectiveTokenA = isNativeAddress(tokenA) ? chain.wrappedNativeAddress.toLowerCase() as Address : tokenA
        const effectiveTokenB = isNativeAddress(tokenB) ? chain.wrappedNativeAddress.toLowerCase() as Address : tokenB

        if (effectiveTokenA === effectiveTokenB) {
            reply.status(400)
            return { error: 'invalid_request', message: 'tokenA and tokenB must be different' }
        }

        let tokenInMeta: TokenMetadata | undefined
        let tokenOutMeta: TokenMetadata | undefined
        let quote: PriceQuote | null = null

        if (parsed.data.amount) {
            try {
                const metadata = await Promise.all([
                    tokenService.getTokenMetadata(chain, effectiveTokenA),
                    tokenService.getTokenMetadata(chain, effectiveTokenB),
                ])
                tokenInMeta = metadata[0]
                tokenOutMeta = metadata[1]
            } catch (error) {
                reply.status(400)
                return { error: 'token_metadata_error', message: (error as Error).message }
            }

            let amountIn: bigint
            try {
                amountIn = parseAmountToUnits(parsed.data.amount, tokenInMeta.decimals)
            } catch (error) {
                reply.status(400)
                return { error: 'invalid_amount', message: (error as Error).message }
            }

            quote = await priceService.getBestQuoteForTokens(
                chain,
                tokenInMeta,
                tokenOutMeta,
                amountIn,
                routePreference,
                forceMultiHop,
                enableSplit,
            )
        } else {
            quote = await priceService.getBestPrice(chain, effectiveTokenA, effectiveTokenB, undefined, routePreference, forceMultiHop, enableSplit)
            if (quote) {
                tokenInMeta = quote.path[0]
                tokenOutMeta = quote.path[quote.path.length - 1]
            }
        }

        if (!quote) {
            reply.status(404)
            return { error: 'no_route', message: 'No on-chain route found for the requested pair' }
        }

        return formatPriceQuote(chain, quote, routePreference)
    })

    app.get('/quote', async (request, reply) => {
        const querySchema = chainQuerySchema.extend({
            tokenA: z.string().trim().refine((value) => isAddress(value, { strict: false }) || value.toLowerCase() === NATIVE_ADDRESS.toLowerCase(), 'Invalid tokenA address'),
            tokenB: z.string().trim().refine((value) => isAddress(value, { strict: false }) || value.toLowerCase() === NATIVE_ADDRESS.toLowerCase(), 'Invalid tokenB address'),
            amount: z.string().min(1, 'Amount is required'),
            slippageBps: z.string().optional(),
            version: z.enum(['auto', 'v2', 'v3']).optional(),
            forceMultiHop: z.enum(['true', 'false']).optional(),
            enableSplit: z.enum(['true', 'false']).optional(),
        })

        const parsed = querySchema.safeParse(request.query)
        if (!parsed.success) {
            reply.status(400)
            return { error: 'invalid_request', details: parsed.error.flatten() }
        }

        let chain
        try {
            chain = resolveChain(parsed.data.chain)
        } catch (error) {
            reply.status(400)
            return { error: 'unsupported_chain', message: (error as Error).message }
        }

        const tokenA = normalizeAddress(parsed.data.tokenA).toLowerCase() as Address
        const tokenB = normalizeAddress(parsed.data.tokenB).toLowerCase() as Address
        const routePreference = resolveRoutePreference(parsed.data.version)
        const forceMultiHop = parsed.data.forceMultiHop === 'true'
        const enableSplit = parsed.data.enableSplit !== 'false'

        if (tokenA === tokenB) {
            reply.status(400)
            return { error: 'invalid_request', message: 'tokenA and tokenB must be different' }
        }

        const isNativeAddress = (addr: string) => addr.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
        const effectiveTokenA = isNativeAddress(tokenA) ? chain.wrappedNativeAddress.toLowerCase() as Address : tokenA
        const effectiveTokenB = isNativeAddress(tokenB) ? chain.wrappedNativeAddress.toLowerCase() as Address : tokenB

        if (effectiveTokenA === effectiveTokenB) {
            reply.status(400)
            return { error: 'invalid_request', message: 'tokenA and tokenB must be different' }
        }

        const slippage = parsed.data.slippageBps ? Number(parsed.data.slippageBps) : 50
        if (Number.isNaN(slippage)) {
            reply.status(400)
            return { error: 'invalid_amount', message: 'slippageBps must be numeric' }
        }

        let result: QuoteResult | null = null
        const cacheKey = `${chain.key}:${effectiveTokenA}:${effectiveTokenB}:${parsed.data.amount}:${routePreference}:${forceMultiHop}:${enableSplit}`
        const cached = quoteCache.get(cacheKey)
        if (cached) {
            result = cached
        } else {
            try {
                result = await quoteService.getQuote(
                    chain,
                    effectiveTokenA,
                    effectiveTokenB,
                    parsed.data.amount,
                    slippage,
                    routePreference,
                    forceMultiHop,
                    enableSplit,
                )
                if (result) quoteCache.set(cacheKey, result)
            } catch (error) {
                reply.status(400)
                return { error: 'invalid_request', message: (error as Error).message }
            }
        }

        if (!result) {
            reply.status(404)
            return { error: 'no_route', message: 'No on-chain route found for the requested pair' }
        }

        const { quote, amountOutMin, tokenOut, slippageBps } = result
        const { quoteId, expiresAt } = quoteStore.store(result)

        const baseResponse = formatPriceQuote(chain, quote, routePreference)
        const amountOutMinFormatted = formatAmountFromUnits(amountOutMin, tokenOut.decimals)

        return {
            ...baseResponse,
            quoteId,
            expiresAt,
            amountOutMin: amountOutMin.toString(),
            amountOutMinFormatted,
            slippageBps,
        }
    })

    app.post('/swap', async (request, reply) => {
        const bodySchema = z.object({
            chain: z.string().min(1),
            tokenA: z.string().trim().refine((value) => {
                return isAddress(value, { strict: false }) || value.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
            }, 'Invalid tokenA address'),
            tokenB: z.string().trim().refine((value) => {
                return isAddress(value, { strict: false }) || value.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
            }, 'Invalid tokenB address'),
            amount: z.string().min(1, 'Amount is required'),
            slippageBps: z.coerce.number().min(0).max(10000).optional(),
            version: z.enum(['auto', 'v2', 'v3']).optional(),
            recipient: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid recipient address'),
            deadlineSeconds: z.coerce.number().min(10).max(3600).optional(),
            forceMultiHop: z.boolean().optional(),
            enableSplit: z.boolean().optional(),
            quoteId: z.string().uuid().optional(),
        })

        const parsed = bodySchema.safeParse(request.body)
        if (!parsed.success) {
            reply.status(400)
            return { error: 'invalid_request', details: parsed.error.flatten() }
        }

        let chain
        try {
            chain = resolveChain(parsed.data.chain)
        } catch (error) {
            reply.status(400)
            return { error: 'unsupported_chain', message: (error as Error).message }
        }

        const tokenA = normalizeAddress(parsed.data.tokenA).toLowerCase() as Address
        const tokenB = normalizeAddress(parsed.data.tokenB).toLowerCase() as Address
        const recipient = normalizeAddress(parsed.data.recipient)
        const routePreference = resolveRoutePreference(parsed.data.version)

        if (tokenA === tokenB) {
            reply.status(400)
            return { error: 'invalid_request', message: 'tokenA and tokenB must be different' }
        }

        const isNativeAddress = (addr: string) => 
            addr.toLowerCase() === NATIVE_ADDRESS.toLowerCase()

        const useNativeInput = isNativeAddress(tokenA)
        const useNativeOutput = isNativeAddress(tokenB)

        const effectiveTokenA = useNativeInput ? chain.wrappedNativeAddress.toLowerCase() as Address : tokenA
        const effectiveTokenB = useNativeOutput ? chain.wrappedNativeAddress.toLowerCase() as Address : tokenB

        if (effectiveTokenA === effectiveTokenB) {
            reply.status(400)
            return { error: 'invalid_request', message: 'tokenA and tokenB resolve to the same token after native wrapping' }
        }

        const slippageInput = Number.isFinite(parsed.data.slippageBps) ? parsed.data.slippageBps! : undefined
        const slippageBps = slippageInput ?? 50
        const deadlineSeconds = Number.isFinite(parsed.data.deadlineSeconds) ? parsed.data.deadlineSeconds! : 180
        const forceMultiHop = parsed.data.forceMultiHop ?? false
        const enableSplit = parsed.data.enableSplit !== false

        request.log.info({ tokenA: effectiveTokenA, tokenB: effectiveTokenB, amount: parsed.data.amount, quoteId: parsed.data.quoteId }, 'Swap request')

        let quoteResult: QuoteResult | null = null

        // Strategy 1: Look up stored quote by quoteId
        if (parsed.data.quoteId) {
            const stored = quoteStore.consume(parsed.data.quoteId)
            if (!stored) {
                const isExpired = quoteStore.isExpired(parsed.data.quoteId)
                reply.status(isExpired ? 410 : 404)
                return {
                    error: isExpired ? 'quote_expired' : 'quote_not_found',
                    message: isExpired
                        ? 'Quote has expired — please request a new quote'
                        : 'Quote not found — it may have already been used or expired',
                }
            }

            // Validate that stored quote matches request params
            const storedTokenIn = stored.result.tokenIn.address.toLowerCase()
            const storedTokenOut = stored.result.tokenOut.address.toLowerCase()
            if (storedTokenIn !== effectiveTokenA || storedTokenOut !== effectiveTokenB) {
                reply.status(400)
                return { error: 'quote_mismatch', message: 'Quote tokens do not match request parameters' }
            }

            quoteResult = stored.result
            request.log.info({ quoteId: parsed.data.quoteId }, 'Using stored quote')
        }

        // Strategy 2: Fresh quote (fallback when no quoteId)
        if (!quoteResult) {
            try {
                quoteResult = await quoteService.getQuote(chain, effectiveTokenA, effectiveTokenB, parsed.data.amount, slippageBps, routePreference, forceMultiHop, enableSplit)
            } catch (error) {
                reply.status(400)
                return { error: 'invalid_request', message: (error as Error).message }
            }
        }

        if (!quoteResult) {
            reply.status(404)
            return { error: 'no_route', message: 'No on-chain route found for the requested pair' }
        }

        const { quote, amountOutMin, tokenOut, slippageBps: boundedSlippage } = quoteResult

        let transaction
        try {
            transaction = swapBuilder.build(chain, {
                quote,
                amountOutMin,
                recipient,
                slippageBps: boundedSlippage,
                deadlineSeconds,
                useNativeInput,
                useNativeOutput,
            })
        } catch (error) {
            reply.status(400)
            return { error: 'calldata_error', message: (error as Error).message }
        }

        let latestBlockNumber: bigint | null = null
        let latestBlockTimestamp: bigint | null = null
        let estimatedGas: bigint | undefined
        let simulationPassed = false

        try {
            const client = await chainClientProvider.getClient(chain)
            const latestBlock = await client.getBlock()
            latestBlockNumber = latestBlock.number ?? null
            latestBlockTimestamp = latestBlock.timestamp ?? null

            if (transaction.call) {
                const stateOverride = buildSimulationOverrides(
                    recipient,
                    useNativeInput ? null : effectiveTokenA,
                    transaction.spender,
                    transaction.amountIn,
                )

                try {
                    await client.call({
                        account: recipient,
                        to: transaction.call.to,
                        data: transaction.call.data,
                        value: transaction.call.value,
                        stateOverride,
                    })
                    simulationPassed = true
                } catch (simError: any) {
                    const revertData = simError?.data ?? simError?.cause?.data
                    const decoded = decodeRevertReason(revertData)
                    request.log.warn({ decoded }, 'Simulation reverted (non-blocking)')
                }

                try {
                    estimatedGas = await client.estimateGas({
                        account: recipient,
                        to: transaction.call.to,
                        data: transaction.call.data,
                        value: transaction.call.value,
                        stateOverride,
                    })
                    estimatedGas = (estimatedGas * 120n) / 100n
                } catch {
                    if (simulationPassed) {
                        const callCount = transaction.executor?.calls.length ?? 1
                        estimatedGas = BigInt(150_000 + callCount * 180_000)
                    }
                }
            }
        } catch (error) {
            request.log.warn({ err: error }, 'Failed to load block metadata or run simulation')
        }

        const quoteTimestamp = Math.floor(Date.now() / 1000)
        const quoteExpiresAt = quoteTimestamp + SWAP_QUOTE_TTL_SECONDS

        const baseResponse = formatPriceQuote(chain, quote, routePreference)
        const amountOutMinFormatted = formatAmountFromUnits(amountOutMin, tokenOut.decimals)

        return {
            ...baseResponse,
            amountOutMin: amountOutMin.toString(),
            amountOutMinFormatted,
            slippageBps: boundedSlippage,
            recipient,
            deadline: transaction.deadline,
            quoteTimestamp,
            quoteExpiresAt,
            quoteValidSeconds: SWAP_QUOTE_TTL_SECONDS,
            quoteBlockNumber: latestBlockNumber ? latestBlockNumber.toString() : null,
            quoteBlockTimestamp: latestBlockTimestamp ? Number(latestBlockTimestamp) : null,
            simulationPassed,
            transaction: {
                kind: transaction.kind,
                dexId: transaction.dexId,
                router: transaction.router,
                spender: transaction.spender,
                amountIn: transaction.amountIn.toString(),
                amountOut: transaction.amountOut.toString(),
                amountOutMinimum: transaction.amountOutMinimum.toString(),
                deadline: transaction.deadline,
                calls: transaction.calls.map((call) => ({
                    target: call.target,
                    allowFailure: call.allowFailure,
                    callData: call.callData,
                    value: (call.value ?? 0n).toString(),
                })),
                call: transaction.call
                    ? {
                        to: transaction.call.to,
                        data: transaction.call.data,
                        value: transaction.call.value.toString(),
                    }
                    : null,
                executor: transaction.executor
                    ? {
                        pulls: transaction.executor.pulls.map((pull) => ({
                            token: pull.token,
                            amount: pull.amount.toString(),
                        })),
                        approvals: transaction.executor.approvals.map((approval) => ({
                            token: approval.token,
                            spender: approval.spender,
                            amount: approval.amount.toString(),
                            revokeAfter: approval.revokeAfter,
                        })),
                        calls: transaction.executor.calls.map((call) => ({
                            target: call.target,
                            value: call.value.toString(),
                            data: call.data,
                        })),
                        tokensToFlush: transaction.executor.tokensToFlush,
                    }
                    : null,
                estimatedGas: estimatedGas?.toString(),
            },
        }
    })

    app.setErrorHandler(errorHandler)

    return app
}

export const startServer = async () => {
    try {
        validateEnv()
    } catch (error) {
        console.error('Environment validation failed:', (error as Error).message)
        process.exit(1)
    }

    const app = await buildServer()
    const port = appConfig.server.port
    const host = appConfig.server.host

    const shutdown = async (signal: string) => {
        app.log.info(`Received ${signal}, shutting down gracefully...`)
        try {
            await app.close()
            process.exit(0)
        } catch (err) {
            app.log.error(err, 'Error during shutdown')
            process.exit(1)
        }
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

    try {
        await app.listen({ port, host })
        app.log.info(`Server listening on ${host}:${port}`)
        return app
    } catch (error) {
        app.log.error(error)
        process.exit(1)
    }
}
