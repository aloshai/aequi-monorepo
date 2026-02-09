interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class TtlCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private cleanupTimer: ReturnType<typeof setInterval>

  constructor(private readonly ttlMs: number, cleanupIntervalMs = 10_000) {
    this.cleanupTimer = setInterval(() => this.evict(), cleanupIntervalMs)
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref()
    }
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  private evict(): void {
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key)
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer)
    this.cache.clear()
  }
}
