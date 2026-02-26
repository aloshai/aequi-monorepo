import type { FastifyInstance } from 'fastify'
import type { AppDeps } from '../deps'
import { handleSwap } from '../controllers/swap.controller'

export default async function swapRoutes(app: FastifyInstance, opts: { deps: AppDeps }) {
  const { deps } = opts

  app.post('/swap', (req, reply) => handleSwap(deps, req, reply))
}
