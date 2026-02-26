import type { FastifyInstance } from 'fastify'
import type { AppDeps } from '../deps'
import { handleGetToken, handleGetAllowance, handleApprove } from '../controllers/token.controller'

export default async function tokenRoutes(app: FastifyInstance, opts: { deps: AppDeps }) {
  const { deps } = opts

  app.get('/token', (req, reply) => handleGetToken(deps, req, reply))
  app.get('/allowance', (req, reply) => handleGetAllowance(deps, req, reply))
  app.post('/approve', (req, reply) => handleApprove(deps, req, reply))
}
