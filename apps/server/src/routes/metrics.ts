import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

interface Counter {
  labels: Record<string, string>
  value: number
}

interface HistogramBucket {
  le: number
  count: number
}

interface HistogramEntry {
  labels: Record<string, string>
  buckets: HistogramBucket[]
  sum: number
  count: number
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

class MetricsCollector {
  private counters = new Map<string, Counter[]>()
  private histograms = new Map<string, HistogramEntry[]>()

  incrementCounter(name: string, labels: Record<string, string>, amount = 1) {
    if (!this.counters.has(name)) this.counters.set(name, [])
    const entries = this.counters.get(name)!
    const key = JSON.stringify(labels)
    const existing = entries.find(e => JSON.stringify(e.labels) === key)
    if (existing) {
      existing.value += amount
    } else {
      entries.push({ labels, value: amount })
    }
  }

  observeHistogram(name: string, labels: Record<string, string>, value: number) {
    if (!this.histograms.has(name)) this.histograms.set(name, [])
    const entries = this.histograms.get(name)!
    const key = JSON.stringify(labels)
    let entry = entries.find(e => JSON.stringify(e.labels) === key)
    if (!entry) {
      entry = {
        labels,
        buckets: DEFAULT_BUCKETS.map(le => ({ le, count: 0 })),
        sum: 0,
        count: 0,
      }
      entries.push(entry)
    }
    entry.sum += value
    entry.count += 1
    for (const bucket of entry.buckets) {
      if (value <= bucket.le) bucket.count += 1
    }
  }

  serialize(): string {
    const lines: string[] = []

    for (const [name, entries] of this.counters) {
      lines.push(`# TYPE ${name} counter`)
      for (const entry of entries) {
        const labelStr = this.formatLabels(entry.labels)
        lines.push(`${name}${labelStr} ${entry.value}`)
      }
    }

    for (const [name, entries] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`)
      for (const entry of entries) {
        const labelStr = this.formatLabels(entry.labels)
        for (const bucket of entry.buckets) {
          const bucketLabels = this.formatLabels({ ...entry.labels, le: String(bucket.le) })
          lines.push(`${name}_bucket${bucketLabels} ${bucket.count}`)
        }
        const infLabels = this.formatLabels({ ...entry.labels, le: '+Inf' })
        lines.push(`${name}_bucket${infLabels} ${entry.count}`)
        lines.push(`${name}_sum${labelStr} ${entry.sum}`)
        lines.push(`${name}_count${labelStr} ${entry.count}`)
      }
    }

    return lines.join('\n') + '\n'
  }

  private formatLabels(labels: Record<string, string>): string {
    const pairs = Object.entries(labels).map(([k, v]) => `${k}="${v}"`)
    return pairs.length ? `{${pairs.join(',')}}` : ''
  }
}

export const metrics = new MetricsCollector()

export default async function metricsRoutes(app: FastifyInstance) {
  app.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done) => {
    if (request.url === '/metrics') { done(); return }

    const durationMs = reply.elapsedTime
    const durationSec = durationMs / 1000
    const method = request.method
    const path = request.routeOptions?.url ?? request.url
    const status = String(reply.statusCode)

    metrics.incrementCounter('http_requests_total', { method, path, status })
    metrics.observeHistogram('http_request_duration_seconds', { method, path }, durationSec)

    done()
  })

  app.get('/metrics', async (_request, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
    return metrics.serialize()
  })
}
