import type { FastifyInstance } from 'fastify'
import type { AppDeps } from '../deps'
import { handleGetPrice } from '../controllers/price.controller'

export default async function priceRoutes(app: FastifyInstance, opts: { deps: AppDeps }) {
  const { deps } = opts

  app.get('/price', (req, reply) => handleGetPrice(deps, req, reply))
}
