import type { FastifyInstance } from 'fastify'
import type { AppDeps } from '../deps'
import { handleGetQuote } from '../controllers/quote.controller'

export default async function quoteRoutes(app: FastifyInstance, opts: { deps: AppDeps }) {
  const { deps } = opts

  app.get('/quote', (req, reply) => handleGetQuote(deps, req, reply))
}
