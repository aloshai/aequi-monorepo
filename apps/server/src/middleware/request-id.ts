import type { FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'crypto'

const MAX_REQUEST_ID_LENGTH = 128

export async function requestIdHook(request: FastifyRequest, reply: FastifyReply) {
  const clientId = request.headers['x-request-id'] as string | undefined
  const requestId = clientId && clientId.length <= MAX_REQUEST_ID_LENGTH
    ? clientId.replace(/[^a-zA-Z0-9\-_]/g, '')
    : randomUUID()
  request.headers['x-request-id'] = requestId
  reply.header('x-request-id', requestId)
  
  request.log = request.log.child({ requestId })
}
