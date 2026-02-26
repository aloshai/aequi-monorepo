import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Address } from 'viem'
import type { AppDeps } from '../deps'
import type { PriceQuote, TokenMetadata } from '../types'
import { priceQuerySchema } from '../schemas/price.schema'
import { resolveChain, resolveRoutePreference, resolveEffectiveTokens, formatPriceQuote } from '../utils/route-helpers'
import { normalizeAddress } from '../utils/trading'
import { parseAmountToUnits } from '../utils/units'

export async function handleGetPrice(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  const parsed = priceQuerySchema.safeParse(request.query)
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

  let tokenInMeta: TokenMetadata | undefined
  let tokenOutMeta: TokenMetadata | undefined
  let quote: PriceQuote | null = null

  if (parsed.data.amount) {
    try {
      const metadata = await Promise.all([
        deps.tokenService.getTokenMetadata(chain, effectiveTokenA),
        deps.tokenService.getTokenMetadata(chain, effectiveTokenB),
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

    quote = await deps.priceService.getBestQuoteForTokens(
      chain, tokenInMeta, tokenOutMeta, amountIn, routePreference, forceMultiHop, enableSplit,
    )
  } else {
    quote = await deps.priceService.getBestPrice(
      chain, effectiveTokenA, effectiveTokenB, undefined, routePreference, forceMultiHop, enableSplit,
    )
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
}
