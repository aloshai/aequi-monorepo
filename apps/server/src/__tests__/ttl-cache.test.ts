import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TtlCache } from '../utils/ttl-cache'

describe('TtlCache', () => {
  let cache: TtlCache<string>

  beforeEach(() => {
    cache = new TtlCache<string>(5000, 60_000)
  })

  afterEach(() => {
    cache.destroy()
  })

  it('stores and retrieves values', () => {
    cache.set('key1', 'value1')
    expect(cache.get('key1')).toBe('value1')
  })

  it('returns undefined for missing keys', () => {
    expect(cache.get('non-existent')).toBeUndefined()
  })

  it('overwrites existing keys', () => {
    cache.set('key1', 'value1')
    cache.set('key1', 'value2')
    expect(cache.get('key1')).toBe('value2')
  })

  it('expires entries after TTL', () => {
    vi.useFakeTimers()
    const shortCache = new TtlCache<string>(100, 60_000)
    shortCache.set('key1', 'value1')

    expect(shortCache.get('key1')).toBe('value1')

    vi.advanceTimersByTime(200)

    expect(shortCache.get('key1')).toBeUndefined()
    shortCache.destroy()
    vi.useRealTimers()
  })

  it('handles multiple keys independently', () => {
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')

    expect(cache.get('a')).toBe('1')
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
  })

  it('destroy clears all entries', () => {
    cache.set('key1', 'value1')
    cache.destroy()
    expect(cache.get('key1')).toBeUndefined()
  })
})
