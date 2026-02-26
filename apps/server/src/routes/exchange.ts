import type { FastifyInstance } from 'fastify'
import type { AppDeps } from '../deps'
import { handleListDexes } from '../controllers/exchange.controller'

export default async function exchangeRoutes(app: FastifyInstance, opts: { deps: AppDeps }) {
  const { deps } = opts

  app.get('/exchange', (req, reply) => handleListDexes(deps, req, reply))
}
