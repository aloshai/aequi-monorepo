import { describe, it, expect } from 'vitest'

const { MetricsCollector } = await import('../routes/metrics').then(m => {
  const collector = m.metrics
  return { MetricsCollector: collector.constructor }
})

function createCollector() {
  return new (MetricsCollector as any)()
}

describe('MetricsCollector', () => {
  it('increments counters', () => {
    const collector = createCollector()
    collector.incrementCounter('http_requests_total', { method: 'GET', path: '/health' })
    collector.incrementCounter('http_requests_total', { method: 'GET', path: '/health' })

    const output = collector.serialize()
    expect(output).toContain('http_requests_total{method="GET",path="/health"} 2')
  })

  it('observes histogram values', () => {
    const collector = createCollector()
    collector.observeHistogram('http_request_duration_seconds', { method: 'GET' }, 0.05)
    collector.observeHistogram('http_request_duration_seconds', { method: 'GET' }, 0.5)

    const output = collector.serialize()
    expect(output).toContain('http_request_duration_seconds_count{method="GET"} 2')
    expect(output).toContain('TYPE http_request_duration_seconds histogram')
  })

  it('serializes counters with Prometheus format', () => {
    const collector = createCollector()
    collector.incrementCounter('test_counter', { label: 'a' }, 5)

    const output = collector.serialize()
    expect(output).toContain('# TYPE test_counter counter')
    expect(output).toContain('test_counter{label="a"} 5')
  })

  it('handles multiple label combinations', () => {
    const collector = createCollector()
    collector.incrementCounter('requests', { method: 'GET', status: '200' })
    collector.incrementCounter('requests', { method: 'POST', status: '201' })

    const output = collector.serialize()
    expect(output).toContain('requests{method="GET",status="200"} 1')
    expect(output).toContain('requests{method="POST",status="201"} 1')
  })
})
