import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Address } from 'viem'
import type { AppDeps } from '../deps'
import { tokenQuerySchema, allowanceQuerySchema, approveBodySchema } from '../schemas/token.schema'
import { resolveChain } from '../utils/route-helpers'
import { normalizeAddress } from '../utils/trading'

export async function handleGetToken(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  const parsed = tokenQuerySchema.safeParse(request.query)
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
  const token = await deps.tokenService.getTokenMetadata(chain, address)

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
}

export async function handleGetAllowance(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  const parsed = allowanceQuerySchema.safeParse(request.query)
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

  const allowances = await deps.allowanceService.getAllowances(chain, owner, spender, tokenList)

  return {
    chain: chain.key,
    owner,
    spender,
    allowances: allowances.map((entry) => ({
      token: entry.token,
      allowance: entry.allowance.toString(),
    })),
  }
}

export async function handleApprove(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  const parsed = approveBodySchema.safeParse(request.body)
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

  const result = await deps.allowanceService.buildApproveCalldata(chain, token, spender, amountInput)

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
}
