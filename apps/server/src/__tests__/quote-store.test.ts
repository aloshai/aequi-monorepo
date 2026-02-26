import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QuoteStore } from '../utils/quote-store'

describe('QuoteStore', () => {
  let store: QuoteStore

  const mockQuoteResult = {
    quote: {
      amountIn: 1000n,
      amountOut: 500n,
      priceQ18: 500000000000000000n,
      midPriceQ18: 510000000000000000n,
      executionPriceQ18: 500000000000000000n,
      priceImpactBps: 50,
      path: [],
      sources: [],
      routeAddresses: [],
      liquidityScore: 100n,
      hopVersions: ['v2' as const],
    },
    amountOutMin: 475n,
    slippageBps: 50,
    tokenIn: { address: '0xaaa', symbol: 'A', name: 'Token A', decimals: 18 },
    tokenOut: { address: '0xbbb', symbol: 'B', name: 'Token B', decimals: 18 },
  } as any

  beforeEach(() => {
    store = new QuoteStore(5000, 100, 60_000)
  })

  afterEach(() => {
    store.destroy()
  })

  it('stores and retrieves a quote', () => {
    const { quoteId, expiresAt } = store.store(mockQuoteResult)
    expect(quoteId).toBeTruthy()
    expect(typeof expiresAt).toBe('number')

    const retrieved = store.peek(quoteId)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.result).toEqual(mockQuoteResult)
  })

  it('consumes a quote only once', () => {
    const { quoteId } = store.store(mockQuoteResult)

    const first = store.consume(quoteId)
    expect(first).not.toBeNull()

    const second = store.consume(quoteId)
    expect(second).toBeNull()
  })

  it('returns null for non-existent quoteId', () => {
    expect(store.peek('non-existent-id')).toBeNull()
    expect(store.consume('non-existent-id')).toBeNull()
  })

  it('expires quotes after TTL', () => {
    vi.useFakeTimers()
    const shortStore = new QuoteStore(100, 100, 60_000)
    const { quoteId } = shortStore.store(mockQuoteResult)

    expect(shortStore.peek(quoteId)).not.toBeNull()

    vi.advanceTimersByTime(200)

    expect(shortStore.peek(quoteId)).toBeNull()
    expect(shortStore.isExpired(quoteId)).toBe(true)
    shortStore.destroy()
    vi.useRealTimers()
  })

  it('evicts oldest when capacity is reached', () => {
    const tinyStore = new QuoteStore(60_000, 3, 60_000)

    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      ids.push(tinyStore.store(mockQuoteResult).quoteId)
    }

    expect(tinyStore.peek(ids[0]!)).toBeNull()
    expect(tinyStore.peek(ids[3]!)).not.toBeNull()
    tinyStore.destroy()
  })

  it('isExpired returns true for unknown IDs', () => {
    expect(store.isExpired('unknown')).toBe(true)
  })
})
