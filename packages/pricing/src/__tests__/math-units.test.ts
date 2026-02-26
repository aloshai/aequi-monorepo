import { describe, it, expect } from 'vitest'
import { Q18, scaleToQ18, multiplyQ18, chainMultiplyQ18, minBigInt } from '../math'
import { defaultAmountForDecimals, descaleFromQ18 } from '../units'

describe('math', () => {
  describe('Q18', () => {
    it('equals 10^18', () => {
      expect(Q18).toBe(1000000000000000000n)
    })
  })

  describe('scaleToQ18', () => {
    it('scales 18-decimal amounts correctly', () => {
      const amount = 1000000000000000000n
      expect(scaleToQ18(amount, 18)).toBe(Q18)
    })

    it('scales 6-decimal amounts correctly', () => {
      const amount = 1_000_000n
      expect(scaleToQ18(amount, 6)).toBe(Q18)
    })

    it('returns 0 for 0 amount', () => {
      expect(scaleToQ18(0n, 18)).toBe(0n)
    })

    it('returns 0 for negative decimals', () => {
      expect(scaleToQ18(1000n, -1)).toBe(0n)
    })
  })

  describe('multiplyQ18', () => {
    it('multiplies two Q18 values', () => {
      const a = 2n * Q18
      const b = 3n * Q18
      expect(multiplyQ18(a, b)).toBe(6n * Q18)
    })

    it('returns 0 when either operand is 0', () => {
      expect(multiplyQ18(0n, Q18)).toBe(0n)
      expect(multiplyQ18(Q18, 0n)).toBe(0n)
    })
  })

  describe('chainMultiplyQ18', () => {
    it('chains multiple Q18 multiplications', () => {
      expect(chainMultiplyQ18([2n * Q18, 3n * Q18, Q18 / 2n])).toBe(3n * Q18)
    })

    it('returns 0 for empty array', () => {
      expect(chainMultiplyQ18([])).toBe(0n)
    })
  })

  describe('minBigInt', () => {
    it('returns the smaller value', () => {
      expect(minBigInt(1n, 2n)).toBe(1n)
      expect(minBigInt(5n, 3n)).toBe(3n)
    })

    it('returns either when equal', () => {
      expect(minBigInt(7n, 7n)).toBe(7n)
    })
  })
})

describe('units', () => {
  describe('defaultAmountForDecimals', () => {
    it('returns 10^decimals', () => {
      expect(defaultAmountForDecimals(18)).toBe(10n ** 18n)
      expect(defaultAmountForDecimals(6)).toBe(10n ** 6n)
    })

    it('returns 0 for negative decimals', () => {
      expect(defaultAmountForDecimals(-1)).toBe(0n)
    })
  })

  describe('descaleFromQ18', () => {
    it('passthrough for 18 decimals', () => {
      expect(descaleFromQ18(Q18, 18)).toBe(Q18)
    })

    it('scales down for 6 decimals', () => {
      expect(descaleFromQ18(Q18, 6)).toBe(1_000_000n)
    })

    it('scales up for >18 decimals', () => {
      expect(descaleFromQ18(Q18, 20)).toBe(Q18 * 100n)
    })
  })
})
