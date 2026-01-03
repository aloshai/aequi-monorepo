import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { performance } from 'node:perf_hooks'
import { URL } from 'node:url'
import type { IncomingMessage } from 'node:http'
import type { ChainConfig } from '../../types'

const CHAINLIST_URL = 'https://chainlist.org/rpcs.json'
const CACHE_TTL_MS = 60 * 60 * 1000
const FAILURE_TTL_MS = 5 * 60 * 1000
const METRICS_TTL_MS = 15 * 60 * 1000
const RPC_PROBE_TIMEOUT_MS = 5_000
const MAX_PROBE_CONCURRENCY = 4
const RATE_LIMIT_HEADERS = ['x-ratelimit-remaining', 'x-rate-limit-remaining', 'ratelimit-remaining'] as const
const RPC_SIGNATURE_DELIMITER = '|' as const

interface ChainlistRpcEntry {
  chainId: number
  rpc?: Array<{
    url?: string | null
  }>
}

interface CacheState {
  expiresAt: number
  data: Map<number, string[]>
}

const cache: CacheState = {
  expiresAt: 0,
  data: new Map<number, string[]>(),
}

let inFlight: Promise<void> | null = null

interface RankingCacheEntry {
  expiresAt: number
  signature: string
  urls: string[]
}

interface RpcProbeResult {
  url: string
  latency: number
  rateLimitRemaining: number | null
  ok: boolean
}

const rankingCache = new Map<number, RankingCacheEntry>()

const requestJson = <T>(target: string): Promise<T> => {
  const url = new URL(target)
  const isHttps = url.protocol === 'https:'

  return new Promise<T>((resolve, reject) => {
    const handler = (response: IncomingMessage) => {
      if (!response.statusCode || response.statusCode >= 400) {
        reject(new Error(`Failed to fetch ${target}: ${response.statusCode ?? 'unknown status'}`))
        response.resume()
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8')
          resolve(JSON.parse(body) as T)
        } catch (error) {
          reject(error)
        }
      })
    }

    const request = (isHttps ? httpsRequest : httpRequest)({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'aequi-price-server',
      },
    }, handler)

    request.on('error', reject)
    request.end()
  })
}

const dedupe = (urls: string[]) => {
  const seen = new Set<string>()
  const result: string[] = []

  for (const url of urls) {
    const trimmed = url.trim()
    if (!trimmed) {
      continue
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(trimmed)
  }

  return result
}

const isHttpUrl = (url: string) => url.startsWith('http://') || url.startsWith('https://')

const hasPlaceholder = (url: string) => url.includes('{') || url.includes('}') || url.includes('${')

const buildSignature = (urls: string[]) =>
  urls
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length)
    .sort()
    .join(RPC_SIGNATURE_DELIMITER)

const parseRateLimitRemaining = (headers: { get(name: string): string | null }) => {
  for (const header of RATE_LIMIT_HEADERS) {
    const raw = headers.get(header)
    if (!raw) {
      continue
    }

    const token = raw.split(',')[0]?.trim()
    const parsed = token ? Number.parseInt(token, 10) : Number.NaN
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }

  return null
}

const probeRpcEndpoint = async (chainId: number, url: string): Promise<RpcProbeResult> => {
  const startedAt = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RPC_PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: controller.signal,
    })

    const latency = performance.now() - startedAt

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const payload = (await response.json()) as { result?: unknown; error?: { message?: string } }
    if (payload?.error?.message) {
      throw new Error(payload.error.message)
    }

    const rawChainId = typeof payload?.result === 'string' ? payload.result : null
    if (!rawChainId) {
      throw new Error('Missing chain id in response')
    }

    const parsedChainId = Number.parseInt(rawChainId, 16)
    if (!Number.isNaN(parsedChainId) && parsedChainId !== chainId) {
      throw new Error(`Chain id mismatch: expected ${chainId}, received ${parsedChainId}`)
    }

    const rateLimitRemaining = parseRateLimitRemaining(response.headers)

    return {
      url,
      latency,
      rateLimitRemaining,
      ok: true,
    }
  } catch (error) {
    const latency = performance.now() - startedAt
    const reason = error instanceof Error ? error.message : 'Unknown error'
    const name = error instanceof Error ? error.name : undefined
    if (name === 'AbortError') {
      console.warn(`[rpc] probe timeout for ${url} (${chainId})`)
    } else {
      console.warn(`[rpc] probe failed for ${url} (${chainId}): ${reason}`)
    }

    return {
      url,
      latency,
      rateLimitRemaining: null,
      ok: false,
    }
  } finally {
    clearTimeout(timeout)
  }
}

const evaluateRpcEndpoints = async (chainId: number, urls: string[]) => {
  if (!urls.length) {
    return []
  }

  const results = new Array<RpcProbeResult>(urls.length)
  let cursor = 0

  const concurrency = Math.min(MAX_PROBE_CONCURRENCY, urls.length)
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor++
      if (index >= urls.length) {
        break
      }
      results[index] = await probeRpcEndpoint(chainId, urls[index]!)
    }
  })

  await Promise.all(workers)

  const healthy = results
    .filter((result) => result.ok)
    .sort((a, b) => {
      if (a.latency !== b.latency) {
        return a.latency - b.latency
      }

      const rateA = a.rateLimitRemaining ?? -1
      const rateB = b.rateLimitRemaining ?? -1
      if (rateA !== rateB) {
        return rateB - rateA
      }

      return a.url.localeCompare(b.url)
    })

  const degraded = results.filter((result) => !result.ok)

  return [...healthy.map((item) => item.url), ...degraded.map((item) => item.url)]
}

const getRankedRpcUrls = async (chainId: number, urls: string[]) => {
  const signature = buildSignature(urls)
  const cached = rankingCache.get(chainId)

  if (cached && cached.signature === signature && Date.now() < cached.expiresAt) {
    return cached.urls
  }

  const ranked = await evaluateRpcEndpoints(chainId, urls)
  if (ranked.length) {
    rankingCache.set(chainId, {
      expiresAt: Date.now() + METRICS_TTL_MS,
      signature,
      urls: ranked,
    })
  }

  return ranked
}

const refreshCache = async () => {
  const payload = await requestJson<ChainlistRpcEntry[]>(CHAINLIST_URL)
  const data = new Map<number, string[]>()

  for (const entry of payload) {
    if (typeof entry.chainId !== 'number' || !Array.isArray(entry.rpc)) {
      continue
    }

    const urls = dedupe(
      entry.rpc
        .map((candidate) => (typeof candidate?.url === 'string' ? candidate.url : ''))
        .filter((url) => url && isHttpUrl(url) && !hasPlaceholder(url)),
    )

    if (urls.length) {
      data.set(entry.chainId, urls)
    }
  }

  cache.data = data
  cache.expiresAt = Date.now() + CACHE_TTL_MS
}

const ensureChainlistCache = async () => {
  if (Date.now() < cache.expiresAt) {
    return
  }

  if (inFlight) {
    return inFlight
  }

  inFlight = (async () => {
    try {
      await refreshCache()
    } catch (error) {
      cache.expiresAt = Date.now() + FAILURE_TTL_MS
      console.warn(`[rpc] chainlist refresh failed: ${(error as Error).message}`)
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

export const resolveRpcUrls = async (chainConfig: ChainConfig): Promise<string[]> => {
  const configured = dedupe([...chainConfig.rpcUrls, ...(chainConfig.fallbackRpcUrls ?? [])])

  if (chainConfig.disablePublicRpcRegistry) {
    return configured
  }

  await ensureChainlistCache()

  const chainlist = cache.data.get(chainConfig.id) ?? []
  const merged = dedupe([...configured, ...chainlist])

  if (!merged.length) {
    return merged
  }

  const ranked = await getRankedRpcUrls(chainConfig.id, merged)
  return ranked.length ? ranked : merged
}

export const clearRpcCache = () => {
  cache.expiresAt = 0
  cache.data.clear()
  rankingCache.clear()
}
