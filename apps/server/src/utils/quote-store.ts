import { randomUUID } from 'crypto'
import type { QuoteResult } from '../types'

interface StoredQuote {
  id: string
  result: QuoteResult
  createdAt: number
  expiresAt: number
  consumed: boolean
}

export class QuoteStore {
  private entries = new Map<string, StoredQuote>()
  private cleanupTimer: ReturnType<typeof setInterval>

  constructor(
    private readonly ttlMs: number,
    private readonly maxCapacity = 10_000,
    cleanupIntervalMs = 10_000,
  ) {
    this.cleanupTimer = setInterval(() => this.evict(), cleanupIntervalMs)
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref()
    }
  }

  store(result: QuoteResult): { quoteId: string; expiresAt: number } {
    if (this.entries.size >= this.maxCapacity) {
      this.evictOldest()
    }

    const id = randomUUID()
    const now = Date.now()
    const expiresAt = now + this.ttlMs

    this.entries.set(id, { id, result, createdAt: now, expiresAt, consumed: false })
    return { quoteId: id, expiresAt: Math.floor(expiresAt / 1000) }
  }

  peek(quoteId: string): StoredQuote | null {
    const entry = this.entries.get(quoteId)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(quoteId)
      return null
    }
    return entry
  }

  consume(quoteId: string): StoredQuote | null {
    const entry = this.peek(quoteId)
    if (!entry) return null
    if (entry.consumed) return null
    entry.consumed = true
    this.entries.delete(quoteId)
    return entry
  }

  isExpired(quoteId: string): boolean {
    const entry = this.entries.get(quoteId)
    if (!entry) return true
    return Date.now() > entry.expiresAt
  }

  private evict(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) this.entries.delete(key)
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of this.entries) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt
        oldestKey = key
      }
    }
    if (oldestKey) this.entries.delete(oldestKey)
  }

  destroy(): void {
    clearInterval(this.cleanupTimer)
    this.entries.clear()
  }
}
