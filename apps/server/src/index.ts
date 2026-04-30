import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { validateEnv } from './config/env'
import { appConfig } from './config/app-config'
import { errorHandler } from './middleware/error-handler'
import { requestIdHook } from './middleware/request-id'
import { loggerConfig } from './config/logger'
import { createDeps } from './deps'
import type { AppDeps } from './deps'

import healthRoutes from './routes/health'
import exchangeRoutes from './routes/exchange'
import tokenRoutes from './routes/token'
import priceRoutes from './routes/price'
import quoteRoutes from './routes/quote'
import swapRoutes from './routes/swap'
import metricsRoutes from './routes/metrics'

validateEnv()

const deps = createDeps()

export const buildServer = async (overrideDeps?: AppDeps) => {
  const d = overrideDeps ?? deps

  const app = Fastify({
    logger: appConfig.server.loggerEnabled ? loggerConfig : false,
    requestTimeout: 30_000,
  })

  app.addHook('onRequest', requestIdHook)

  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : (process.env.NODE_ENV === 'production' ? false : true)
  await app.register(cors, { origin: allowedOrigins })
  await app.register(rateLimit, {
    max: appConfig.rateLimit.max,
    timeWindow: appConfig.rateLimit.window,
  })

  app.addHook('onSend', (_request, reply, payload, done) => {
    reply.header('X-Powered-By', 'Aequi')
    done()
  })

  await app.register(metricsRoutes)
  await app.register(healthRoutes, { deps: d })
  await app.register(exchangeRoutes, { deps: d })
  await app.register(tokenRoutes, { deps: d })
  await app.register(priceRoutes, { deps: d })
  await app.register(quoteRoutes, { deps: d })
  await app.register(swapRoutes, { deps: d })

  app.setErrorHandler(errorHandler)

  return app
}

export const startServer = async () => {
  const app = await buildServer()
  const port = appConfig.server.port
  const host = appConfig.server.host

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`)
    try {
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error(err, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  try {
    await app.listen({ port, host })
    console.log(`
  ┌─────────────────────────────────────┐
  │                                     │
  │          A E Q U I   D E X          │
  │        Aggregator  &  Router        │
  │                                     │
  │   ${`http://${host}:${port}`.padEnd(35)} │
  │   env: ${(process.env.NODE_ENV ?? 'development').padEnd(29)} │
  │                                     │
  └─────────────────────────────────────┘
`)
    return app
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}
