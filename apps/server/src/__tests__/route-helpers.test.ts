import { describe, it, expect } from 'vitest'
import { resolveRoutePreference, isNativeAddress } from '../utils/route-helpers'

describe('resolveRoutePreference', () => {
  it('returns auto when no value is provided', () => {
    expect(resolveRoutePreference()).toBe('auto')
    expect(resolveRoutePreference(undefined)).toBe('auto')
  })

  it('returns v2 for v2 input (case insensitive)', () => {
    expect(resolveRoutePreference('v2')).toBe('v2')
    expect(resolveRoutePreference('V2')).toBe('v2')
  })

  it('returns v3 for v3 input (case insensitive)', () => {
    expect(resolveRoutePreference('v3')).toBe('v3')
    expect(resolveRoutePreference('V3')).toBe('v3')
  })

  it('returns auto for unknown values', () => {
    expect(resolveRoutePreference('v4')).toBe('auto')
    expect(resolveRoutePreference('random')).toBe('auto')
    expect(resolveRoutePreference('')).toBe('auto')
  })
})

describe('isNativeAddress', () => {
  it('detects native sentinel address', () => {
    expect(isNativeAddress('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')).toBe(true)
    expect(isNativeAddress('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')).toBe(true)
  })

  it('rejects non-native addresses', () => {
    expect(isNativeAddress('0x0000000000000000000000000000000000000000')).toBe(false)
    expect(isNativeAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(false)
  })
})
