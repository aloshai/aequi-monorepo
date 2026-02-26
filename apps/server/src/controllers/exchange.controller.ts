import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AppDeps } from '../deps'
import { chainQuerySchema } from '../schemas/common'
import { resolveChain } from '../utils/route-helpers'

export async function handleListDexes(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
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

  const dexes = deps.exchangeService.listDexes(chain).map((dex) => ({
    id: dex.id,
    label: dex.label,
    protocol: dex.protocol,
    version: dex.version,
    factoryAddress: dex.factoryAddress,
    routerAddress: dex.routerAddress,
    feeTiers: dex.feeTiers ?? [],
  }))

  return { chain: chain.key, dexes }
}
