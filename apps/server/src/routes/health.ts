import type { FastifyInstance } from 'fastify'
import type { AppDeps } from '../deps'
import { handleHealthCheck, handleLivenessCheck, handleReadinessCheck } from '../controllers/health.controller'

export default async function healthRoutes(app: FastifyInstance, opts: { deps: AppDeps }) {
  const { deps } = opts

  app.get('/health', (req, reply) => handleHealthCheck(deps, req, reply))
  app.get('/health/live', (req, reply) => handleLivenessCheck(deps, req, reply))
  app.get('/health/ready', (req, reply) => handleReadinessCheck(deps, req, reply))
}
