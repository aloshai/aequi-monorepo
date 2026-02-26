import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AppDeps } from '../deps'

export async function handleHealthCheck(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  return deps.healthService.handleHealthCheck(request, reply)
}

export async function handleLivenessCheck(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  return deps.healthService.handleLivenessCheck(request, reply)
}

export async function handleReadinessCheck(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  return deps.healthService.handleReadinessCheck(request, reply)
}
