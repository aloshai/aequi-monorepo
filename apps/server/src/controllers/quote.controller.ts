import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AppDeps } from '../deps'
import type { QuoteResult } from '../types'
import { quoteQuerySchema } from '../schemas/quote.schema'
import { resolveChain, resolveRoutePreference, resolveEffectiveTokens, formatPriceQuote } from '../utils/route-helpers'
import { normalizeAddress } from '../utils/trading'
import { formatAmountFromUnits } from '../utils/units'
import { computeRecommendedSlippage } from '../services/quote/quote-service'

export async function handleGetQuote(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  const parsed = quoteQuerySchema.safeParse(request.query)
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

  const { effectiveTokenA, effectiveTokenB } = resolveEffectiveTokens(parsed.data.tokenA, parsed.data.tokenB, chain)
  const routePreference = resolveRoutePreference(parsed.data.version)
  const forceMultiHop = parsed.data.forceMultiHop === 'true'
  const enableSplit = parsed.data.enableSplit !== 'false'

  if (normalizeAddress(parsed.data.tokenA).toLowerCase() === normalizeAddress(parsed.data.tokenB).toLowerCase()) {
    reply.status(400)
    return { error: 'invalid_request', message: 'tokenA and tokenB must be different' }
  }

  if (effectiveTokenA === effectiveTokenB) {
    reply.status(400)
    return { error: 'invalid_request', message: 'tokenA and tokenB must be different' }
  }

  const isAutoSlippage = !parsed.data.slippageBps || parsed.data.slippageBps === 'auto'
  const explicitSlippage = isAutoSlippage ? null : Number(parsed.data.slippageBps)
  if (explicitSlippage !== null && Number.isNaN(explicitSlippage)) {
    reply.status(400)
    return { error: 'invalid_amount', message: 'slippageBps must be numeric or "auto"' }
  }

  let result: QuoteResult | null = null
  const cacheKey = `${chain.key}:${effectiveTokenA}:${effectiveTokenB}:${parsed.data.amount}:${routePreference}:${forceMultiHop}:${enableSplit}`
  const cached = deps.quoteCache.get(cacheKey)
  if (cached) {
    result = cached
  } else {
    try {
      result = await deps.quoteService.getQuote(
        chain, effectiveTokenA, effectiveTokenB, parsed.data.amount,
        explicitSlippage ?? 50, routePreference, forceMultiHop, enableSplit,
      )
      if (result) deps.quoteCache.set(cacheKey, result)
    } catch (error) {
      reply.status(400)
      return { error: 'invalid_request', message: (error as Error).message }
    }
  }

  if (!result) {
    reply.status(404)
    return { error: 'no_route', message: 'No on-chain route found for the requested pair' }
  }

  const { quote, tokenOut } = result
  const recommended = computeRecommendedSlippage(quote)
  const effectiveSlippage = isAutoSlippage ? recommended : result.slippageBps

  const feeAmount = result.feeAmount ?? 0n
  const amountOutAfterFee = quote.amountOut - feeAmount
  const slippageAmount = (amountOutAfterFee * BigInt(effectiveSlippage)) / 10000n
  const effectiveAmountOutMin = amountOutAfterFee > slippageAmount ? amountOutAfterFee - slippageAmount : 0n

  const storedResult: QuoteResult = { ...result, amountOutMin: effectiveAmountOutMin, slippageBps: effectiveSlippage }
  const { quoteId, expiresAt } = deps.quoteStore.store(storedResult)

  const baseResponse = formatPriceQuote(chain, quote, routePreference)
  const amountOutMinFormatted = formatAmountFromUnits(effectiveAmountOutMin, tokenOut.decimals)

  const feeBps = result.feeBps ?? 0
  const feeAmountFormatted = feeAmount > 0n ? formatAmountFromUnits(feeAmount, tokenOut.decimals) : '0'

  return {
    ...baseResponse,
    quoteId,
    expiresAt,
    amountOutMin: effectiveAmountOutMin.toString(),
    amountOutMinFormatted,
    slippageBps: effectiveSlippage,
    recommendedSlippageBps: recommended,
    feeBps,
    feeAmount: feeAmount.toString(),
    feeAmountFormatted,
  }
}
