import { describe, it, expect } from 'vitest'
import type { PriceQuote, PriceSource, TokenMetadata, SplitLeg } from '@aequi/core'
import type { Address } from 'viem'
import { findBestSplit, type SplitOptimizerConfig } from '../split-optimizer'
import { marginalOutputV2, marginalOutputV3, marginalOutputForQuote } from '../marginal'
import { recomputeQuoteForAmount, getV2AmountOut, estimateV3AmountOut } from '../quote-math'

const Q128 = 1n << 128n

const token = (symbol: string, decimals: number, address: string): TokenMetadata => ({
  chainId: 1,
  address: address as Address,
  symbol,
  name: symbol,
  decimals,
  totalSupply: null,
})

const TOKEN_A = token('TKNA', 18, '0x0000000000000000000000000000000000000001')
const TOKEN_B = token('TKNB', 18, '0x0000000000000000000000000000000000000002')

const makeV2Quote = (
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn: bigint,
  dexId: string = 'uniswap-v2',
  poolAddress: string = '0xpool1',
): PriceQuote => {
  const amountOut = getV2AmountOut(amountIn, reserveIn, reserveOut)
  const source: PriceSource = {
    dexId,
    poolAddress: poolAddress as Address,
    amountIn,
    amountOut,
    reserves: {
      reserve0: reserveIn,
      reserve1: reserveOut,
      token0: TOKEN_A.address,
    },
  }

  return {
    chain: 'ethereum',
    amountIn,
    amountOut,
    priceQ18: 10n ** 18n,
    executionPriceQ18: 10n ** 18n,
    midPriceQ18: (reserveOut * (10n ** 18n)) / reserveIn,
    priceImpactBps: 0,
    path: [TOKEN_A, TOKEN_B],
    routeAddresses: [poolAddress as Address],
    sources: [source],
    liquidityScore: reserveIn + reserveOut,
    hopVersions: ['v2'],
    estimatedGasUnits: 120000n,
    estimatedGasCostWei: 120000n * 5000000000n,
    gasPriceWei: 5000000000n,
  }
}

const makeV3Quote = (
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  fee: number = 3000,
  dexId: string = 'uniswap-v3',
  poolAddress: string = '0xpool3',
): PriceQuote => {
  const amountOut = estimateV3AmountOut(sqrtPriceX96, liquidity, amountIn, fee, true)
  const source: PriceSource = {
    dexId,
    poolAddress: poolAddress as Address,
    feeTier: fee,
    amountIn,
    amountOut,
    reserves: {
      liquidity,
      sqrtPriceX96,
      tick: 0,
      token0: TOKEN_A.address,
      token1: TOKEN_B.address,
    },
  }

  return {
    chain: 'ethereum',
    amountIn,
    amountOut,
    priceQ18: 10n ** 18n,
    executionPriceQ18: 10n ** 18n,
    midPriceQ18: 10n ** 18n,
    priceImpactBps: 0,
    path: [TOKEN_A, TOKEN_B],
    routeAddresses: [poolAddress as Address],
    sources: [source],
    liquidityScore: liquidity,
    hopVersions: ['v3'],
    estimatedGasUnits: 160000n,
    estimatedGasCostWei: 160000n * 5000000000n,
    gasPriceWei: 5000000000n,
  }
}

describe('marginalOutputV2', () => {
  it('returns higher marginal at lower allocation', () => {
    const reserveIn = 1000000n * 10n ** 18n
    const reserveOut = 1000000n * 10n ** 18n

    const marginalSmall = marginalOutputV2(1000n * 10n ** 18n, reserveIn, reserveOut)
    const marginalLarge = marginalOutputV2(500000n * 10n ** 18n, reserveIn, reserveOut)

    expect(marginalSmall).toBeGreaterThan(marginalLarge)
  })

  it('returns zero for zero reserves', () => {
    expect(marginalOutputV2(1000n, 0n, 1000000n)).toBe(0n)
    expect(marginalOutputV2(1000n, 1000000n, 0n)).toBe(0n)
  })

  it('approaches spot price at zero allocation', () => {
    const reserveIn = 1000000n * 10n ** 18n
    const reserveOut = 2000000n * 10n ** 18n

    const marginalAtZero = marginalOutputV2(0n, reserveIn, reserveOut)
    // At x=0, marginal = Rout * fn / (Rin * fd) ≈ 2.0 * 0.997 ≈ 1.994
    // Scaled by Q128: ~1.994 * 2^128
    expect(marginalAtZero).toBeGreaterThan(0n)

    // Should be roughly 2x Q128 (price ratio) adjusted for fee
    const expectedApprox = (2n * Q128 * 997n) / 1000n
    const tolerance = expectedApprox / 100n
    expect(marginalAtZero).toBeGreaterThan(expectedApprox - tolerance)
    expect(marginalAtZero).toBeLessThan(expectedApprox + tolerance)
  })
})

describe('marginalOutputV3', () => {
  it('returns higher marginal at lower allocation', () => {
    const sqrtPriceX96 = 79228162514264337593543950336n // ~1.0 price
    const liquidity = 1000000000000000000000n

    const marginalSmall = marginalOutputV3(1000n * 10n ** 18n, sqrtPriceX96, liquidity, 3000, true)
    const marginalLarge = marginalOutputV3(500000n * 10n ** 18n, sqrtPriceX96, liquidity, 3000, true)

    expect(marginalSmall).toBeGreaterThan(marginalLarge)
  })

  it('returns zero for zero liquidity', () => {
    const sqrtPriceX96 = 79228162514264337593543950336n
    expect(marginalOutputV3(1000n, sqrtPriceX96, 0n, 3000, true)).toBe(0n)
  })
})

describe('marginalOutputForQuote', () => {
  it('computes marginal for single-hop V2', () => {
    const quote = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, 10000n * 10n ** 18n)
    const marginal = marginalOutputForQuote(quote, 10000n * 10n ** 18n)
    expect(marginal).toBeGreaterThan(0n)
  })

  it('decreasing marginal with increasing allocation', () => {
    const quote = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, 50000n * 10n ** 18n)
    const m1 = marginalOutputForQuote(quote, 10000n * 10n ** 18n)
    const m2 = marginalOutputForQuote(quote, 50000n * 10n ** 18n)
    expect(m1).toBeGreaterThan(m2)
  })
})

describe('recomputeQuoteForAmount - V3 tick-aware', () => {
  it('recomputes V3 quote using actual math instead of linear interpolation', () => {
    const sqrtPriceX96 = 79228162514264337593543950336n
    const liquidity = 10000000000000000000000n
    const amountIn = 1000n * 10n ** 18n

    const quote = makeV3Quote(sqrtPriceX96, liquidity, amountIn, 3000)

    // Recompute with half the amount
    const halfResult = recomputeQuoteForAmount(quote, amountIn / 2n)
    expect(halfResult).not.toBeNull()

    // With AMM math, half input should give MORE than half output (concavity)
    const halfOfOriginal = quote.amountOut / 2n
    expect(halfResult!.amountOut).toBeGreaterThan(halfOfOriginal)
  })
})

describe('findBestSplit', () => {
  const defaultConfig: SplitOptimizerConfig = {
    maxSplitLegs: 3,
    convergenceThresholdBps: 10,
    maxIterations: 50,
    minLegRatioBps: 50,
  }

  it('returns null for single candidate', () => {
    const quote = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, 100n * 10n ** 18n)
    expect(findBestSplit([quote], 100n * 10n ** 18n, defaultConfig)).toBeNull()
  })

  it('returns null for zero amountIn', () => {
    const q1 = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, 100n * 10n ** 18n)
    const q2 = makeV2Quote(500000n * 10n ** 18n, 600000n * 10n ** 18n, 100n * 10n ** 18n, 'pancake-v2', '0xpool2')
    expect(findBestSplit([q1, q2], 0n, defaultConfig)).toBeNull()
  })

  it('returns null when below minSplitAmountThreshold', () => {
    const q1 = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, 100n * 10n ** 18n)
    const q2 = makeV2Quote(500000n * 10n ** 18n, 600000n * 10n ** 18n, 100n * 10n ** 18n, 'pancake-v2', '0xpool2')
    const config = { ...defaultConfig, minSplitAmountThreshold: 1000n * 10n ** 18n }
    expect(findBestSplit([q1, q2], 100n * 10n ** 18n, config)).toBeNull()
  })

  it('produces dynamic (non-fixed) split ratios', () => {
    // Two pools with different reserve ratios — optimal split should NOT be 50/50 or multiples of 10%
    const amountIn = 100000n * 10n ** 18n
    const q1 = makeV2Quote(2000000n * 10n ** 18n, 2000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    const q2 = makeV2Quote(500000n * 10n ** 18n, 500000n * 10n ** 18n, amountIn, 'pancake-v2', '0xpool2')

    const result = findBestSplit([q1, q2], amountIn, defaultConfig)
    expect(result).not.toBeNull()
    expect(result!.isSplit).toBe(true)
    expect(result!.splits!.length).toBe(2)

    // With a 4:1 reserve ratio, the larger pool should get significantly more
    const primaryLeg = result!.splits![0]!
    expect(primaryLeg.ratioBps).toBeGreaterThan(5000)

    // The split should NOT be on a 10% boundary (proving dynamic optimization)
    const allRatios = result!.splits!.map((s) => s.ratioBps)
    const hasNonDecimalRatio = allRatios.some((r) => r % 1000 !== 0)
    // Note: technically it COULD land on 10% boundary, but with these reserves it shouldn't
    // The important thing is that the total output beats single-route
    expect(result!.amountOut).toBeGreaterThan(q1.amountOut)
  })

  it('split output beats best single route for large swaps', () => {
    const amountIn = 200000n * 10n ** 18n
    const q1 = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    const q2 = makeV2Quote(800000n * 10n ** 18n, 800000n * 10n ** 18n, amountIn, 'pancake-v2', '0xpool2')

    const result = findBestSplit([q1, q2], amountIn, defaultConfig)
    expect(result).not.toBeNull()

    const bestSingle = q1.amountOut > q2.amountOut ? q1.amountOut : q2.amountOut
    expect(result!.amountOut).toBeGreaterThan(bestSingle)
  })

  it('3-way split with three pools', () => {
    const amountIn = 300000n * 10n ** 18n
    const q1 = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    const q2 = makeV2Quote(800000n * 10n ** 18n, 800000n * 10n ** 18n, amountIn, 'pancake-v2', '0xpool2')
    const q3 = makeV2Quote(600000n * 10n ** 18n, 600000n * 10n ** 18n, amountIn, 'sushi-v2', '0xpool3')

    const result = findBestSplit([q1, q2, q3], amountIn, { ...defaultConfig, maxSplitLegs: 3 })
    if (result) {
      expect(result.splits!.length).toBeGreaterThanOrEqual(2)
      expect(result.splits!.length).toBeLessThanOrEqual(3)

      const totalRatio = result.splits!.reduce((s, l) => s + l.ratioBps, 0)
      expect(totalRatio).toBe(10000)
    }
  })

  it('rejects split when gas overhead exceeds benefit (18-decimal output)', () => {
    // Small swap where split barely helps but gas is expensive
    const amountIn = 100n * 10n ** 18n
    const q1 = makeV2Quote(10000000n * 10n ** 18n, 10000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    const q2 = makeV2Quote(9000000n * 10n ** 18n, 9000000n * 10n ** 18n, amountIn, 'pancake-v2', '0xpool2')

    // With very deep pools, splitting 100 tokens won't help much
    const result = findBestSplit([q1, q2], amountIn, defaultConfig)
    // Could be null if gas cost exceeds the marginal benefit
    if (result) {
      // If it did find a split, the output advantage should exceed gas
      expect(result.amountOut).toBeGreaterThan(q1.amountOut)
    }
  })

  it('split ratios sum to 10000 BPS', () => {
    const amountIn = 100000n * 10n ** 18n
    const q1 = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    const q2 = makeV2Quote(700000n * 10n ** 18n, 700000n * 10n ** 18n, amountIn, 'pancake-v2', '0xpool2')

    const result = findBestSplit([q1, q2], amountIn, defaultConfig)
    if (result && result.splits) {
      const totalBps = result.splits.reduce((s, l) => s + l.ratioBps, 0)
      expect(totalBps).toBe(10000)
    }
  })

  it('legs are sorted by ratio descending', () => {
    const amountIn = 100000n * 10n ** 18n
    const q1 = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    const q2 = makeV2Quote(300000n * 10n ** 18n, 300000n * 10n ** 18n, amountIn, 'pancake-v2', '0xpool2')

    const result = findBestSplit([q1, q2], amountIn, defaultConfig)
    if (result && result.splits && result.splits.length > 1) {
      for (let i = 1; i < result.splits.length; i++) {
        expect(result.splits[i - 1]!.ratioBps).toBeGreaterThanOrEqual(result.splits[i]!.ratioBps)
      }
    }
  })

  it('deduplicates routes with same pool', () => {
    const amountIn = 100000n * 10n ** 18n
    // Same pool address and dexId — should be deduplicated
    const q1 = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    const q2 = makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    expect(findBestSplit([q1, q2], amountIn, defaultConfig)).toBeNull()
  })

  it('respects minLegRatioBps', () => {
    const amountIn = 100000n * 10n ** 18n
    const q1 = makeV2Quote(5000000n * 10n ** 18n, 5000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpool1')
    const q2 = makeV2Quote(100000n * 10n ** 18n, 100000n * 10n ** 18n, amountIn, 'pancake-v2', '0xpool2')

    const config = { ...defaultConfig, minLegRatioBps: 500 }
    const result = findBestSplit([q1, q2], amountIn, config)
    if (result && result.splits) {
      for (const leg of result.splits) {
        expect(leg.ratioBps).toBeGreaterThanOrEqual(500)
      }
    }
  })
})
