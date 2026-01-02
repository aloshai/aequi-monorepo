import { createPublicClient, custom, fallback, http } from 'viem'
import type { EIP1193RequestFn, PublicClient } from 'viem'
import type { ChainConfig, ChainKey } from '@aequi/core'
import { resolveRpcUrls } from '../services/rpc/rpc-registry'

const clientCache = new Map<ChainKey, Promise<PublicClient>>()
const MAX_PRIMARY_RPCS = 3

type HttpTransportFactory = ReturnType<typeof http>
type HttpTransportOptions = Parameters<HttpTransportFactory>[0]

const createLoadBalancedTransport = (factories: HttpTransportFactory[]): HttpTransportFactory => {
  const transports = factories.filter((factory): factory is HttpTransportFactory => Boolean(factory))
  if (!transports.length) {
    throw new Error('Load balanced transport requires at least one transport')
  }

  return (options: HttpTransportOptions) => {
    const { chain, pollingInterval, retryCount, timeout } = options
    const resolved = transports.map((transport) =>
      transport({ chain, pollingInterval, retryCount, timeout }),
    )

    let cursor = 0
    const total = resolved.length
    const base = resolved[0]!
    type RequestFn = typeof base.request

    const request: RequestFn = (async (args) => {
      let lastError: unknown

      for (let offset = 0; offset < total; offset++) {
        const index = (cursor + offset) % total
        const transport = resolved[index]!

        try {
          const result = await transport.request(args)
          cursor = (index + 1) % total
          return result as Awaited<ReturnType<RequestFn>>
        } catch (error) {
          lastError = error
        }
      }

      cursor = 0
      throw lastError instanceof Error
        ? lastError
        : new Error('All load balanced transports failed')
    }) as RequestFn

    const customRequest: EIP1193RequestFn = async ({ method, params }) =>
      request({ method, params } as Parameters<RequestFn>[0])

    const configured = custom({
      async request(args) {
        return customRequest(args)
      },
    })({ chain, pollingInterval, retryCount, timeout })

    return {
      config: {
        ...configured.config,
        key: 'loadBalanced',
        name: 'Load Balanced HTTP',
        type: 'http',
        methods: base.config.methods,
        retryCount: retryCount ?? base.config.retryCount,
        retryDelay: base.config.retryDelay,
        timeout: timeout ?? base.config.timeout,
      },
      request: configured.request,
      value: configured.value,
    }
  }
}

export const getPublicClient = (chainConfig: ChainConfig): Promise<PublicClient> => {
  const existing = clientCache.get(chainConfig.key)
  if (existing) {
    return existing
  }

  const clientPromise = buildClient(chainConfig)
  clientCache.set(chainConfig.key, clientPromise)
  return clientPromise
}

const buildClient = async (chainConfig: ChainConfig): Promise<PublicClient> => {
  const rpcUrls = await resolveRpcUrls(chainConfig)
  if (!rpcUrls.length) {
    throw new Error(`No RPC URLs available for chain ${chainConfig.name}`)
  }

  const primaryRpcUrls = rpcUrls.slice(0, MAX_PRIMARY_RPCS)
  const fallbackRpcUrls = rpcUrls.slice(primaryRpcUrls.length)

  const primaryTransports = primaryRpcUrls.map((url) => http(url))
  const fallbackTransports = fallbackRpcUrls.map((url) => http(url))

  const cascaded: HttpTransportFactory[] = []
  if (primaryTransports.length === 1) {
    console.debug('Creating single transport for', chainConfig.name)
    cascaded.push(primaryTransports[0]!)
  } else if (primaryTransports.length > 1) {
    console.debug('Creating load balanced transport for', chainConfig.name)
    cascaded.push(createLoadBalancedTransport(primaryTransports))
  }

  for (const transport of fallbackTransports) {
    cascaded.push(transport)
  }

  const transport = cascaded.length === 1 ? cascaded[0]! : fallback(cascaded)

  return createPublicClient({
    chain: chainConfig.viemChain,
    transport,
  })
}
