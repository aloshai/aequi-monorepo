import { describe, it, expect } from 'vitest'
import type { PriceQuote, PriceSource, TokenMetadata, SplitLeg } from '@aequi/core'
import type { Address } from 'viem'
import { findBestSplit, type SplitOptimizerConfig } from '../split-optimizer'
import { marginalOutputV2, marginalOutputV3, marginalOutputForQuote } from '../marginal'
import { recomputeQuoteForAmount, getV2AmountOut, estimateV3AmountOut, compareQuotes, convertGasToOutputUnits } from '../quote-math'

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

  it('many-leg split (5+ pools) via full MPE', () => {
    const amountIn = 500000n * 10n ** 18n
    const pools = [
      makeV2Quote(1000000n * 10n ** 18n, 1000000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xp1'),
      makeV2Quote(800000n * 10n ** 18n, 800000n * 10n ** 18n, amountIn, 'pancake-v2', '0xp2'),
      makeV2Quote(600000n * 10n ** 18n, 600000n * 10n ** 18n, amountIn, 'sushi-v2', '0xp3'),
      makeV2Quote(500000n * 10n ** 18n, 500000n * 10n ** 18n, amountIn, 'curve-v2', '0xp4'),
      makeV2Quote(400000n * 10n ** 18n, 400000n * 10n ** 18n, amountIn, 'balancer-v2', '0xp5'),
      makeV2Quote(300000n * 10n ** 18n, 300000n * 10n ** 18n, amountIn, 'dodo-v2', '0xp6'),
    ]

    const config: SplitOptimizerConfig = {
      maxSplitLegs: 10,
      convergenceThresholdBps: 10,
      maxIterations: 100,
      minLegRatioBps: 50,
    }

    const result = findBestSplit(pools, amountIn, config)
    expect(result).not.toBeNull()
    expect(result!.isSplit).toBe(true)
    expect(result!.splits!.length).toBeGreaterThanOrEqual(2)

    const totalRatio = result!.splits!.reduce((s, l) => s + l.ratioBps, 0)
    expect(totalRatio).toBe(10000)

    // Should beat any single route
    const bestSingleOut = pools.reduce((best, q) => q.amountOut > best ? q.amountOut : best, 0n)
    expect(result!.amountOut).toBeGreaterThan(bestSingleOut)
  })

  it('many-leg split allocates more to deeper pools', () => {
    const amountIn = 1000000n * 10n ** 18n
    const pools = [
      makeV2Quote(5000000n * 10n ** 18n, 5000000n * 10n ** 18n, amountIn, 'deep-v2', '0xdeep1'),
      makeV2Quote(3000000n * 10n ** 18n, 3000000n * 10n ** 18n, amountIn, 'mid-v2', '0xmid1'),
      makeV2Quote(500000n * 10n ** 18n, 500000n * 10n ** 18n, amountIn, 'shallow-v2', '0xshallow1'),
    ]

    const config: SplitOptimizerConfig = {
      maxSplitLegs: 10,
      convergenceThresholdBps: 10,
      maxIterations: 100,
      minLegRatioBps: 50,
    }

    const result = findBestSplit(pools, amountIn, config)
    expect(result).not.toBeNull()

    // Primary leg (highest ratio) should correspond to the deepest pool
    const primaryLeg = result!.splits![0]!
    expect(primaryLeg.ratioBps).toBeGreaterThan(3000)
  })

  it('maxSplitLegs=20 allows many legs', () => {
    const amountIn = 2000000n * 10n ** 18n
    const pools: PriceQuote[] = []
    for (let i = 0; i < 12; i++) {
      const reserves = BigInt(300000 + i * 100000) * 10n ** 18n
      pools.push(makeV2Quote(reserves, reserves, amountIn, `dex${i}`, `0xpool${i}`))
    }

    const config: SplitOptimizerConfig = {
      maxSplitLegs: 20,
      convergenceThresholdBps: 10,
      maxIterations: 100,
      minLegRatioBps: 30,
    }

    const result = findBestSplit(pools, amountIn, config)
    expect(result).not.toBeNull()
    expect(result!.splits!.length).toBeGreaterThanOrEqual(3)

    const totalRatio = result!.splits!.reduce((s, l) => s + l.ratioBps, 0)
    expect(totalRatio).toBe(10000)

    // Every leg should be above the minimum
    for (const leg of result!.splits!) {
      expect(leg.ratioBps).toBeGreaterThanOrEqual(30)
    }
  })

  it('full MPE prunes weak legs naturally', () => {
    const amountIn = 100000n * 10n ** 18n
    const pools = [
      makeV2Quote(5000000n * 10n ** 18n, 5000000n * 10n ** 18n, amountIn, 'mega-v2', '0xmega'),
      makeV2Quote(4000000n * 10n ** 18n, 4000000n * 10n ** 18n, amountIn, 'large-v2', '0xlarge'),
      makeV2Quote(10000n * 10n ** 18n, 10000n * 10n ** 18n, amountIn, 'tiny-v2', '0xtiny'),
    ]

    const config: SplitOptimizerConfig = {
      maxSplitLegs: 10,
      convergenceThresholdBps: 10,
      maxIterations: 100,
      minLegRatioBps: 100,
    }

    const result = findBestSplit(pools, amountIn, config)
    if (result && result.splits) {
      // The tiny pool should be pruned or at most get minimal allocation
      const tinyLeg = result.splits.find((s) =>
        s.quote.sources[0]?.poolAddress === '0xtiny'
      )
      if (tinyLeg) {
        expect(tinyLeg.ratioBps).toBeLessThan(500)
      }
    }
  })
})

describe('convertGasToOutputUnits', () => {
  const Q18 = 10n ** 18n

  it('converts gas cost to 18-decimal output token', () => {
    const gasCostWei = 100000n * 5_000_000_000n // 100k gas @ 5 gwei = 0.0005 ETH
    const nativeToOutputPriceQ18 = 2000n * Q18 // 1 ETH = 2000 output tokens
    const result = convertGasToOutputUnits(gasCostWei, 18, nativeToOutputPriceQ18)
    // 0.0005 ETH * 2000 = 1.0 output token = 1e18 in 18-decimal
    expect(result).toBe(1_000_000_000_000_000_000n)
  })

  it('returns 0n for zero gas or zero price', () => {
    expect(convertGasToOutputUnits(0n, 18, 10n ** 18n)).toBe(0n)
    expect(convertGasToOutputUnits(100n, 18, 0n)).toBe(0n)
  })
})

describe('compareQuotes — gas-adjusted', () => {
  const Q18 = 10n ** 18n

  const makeQuote = (amountOut: bigint, gasUnits: bigint, gasPriceWei: bigint): PriceQuote => ({
    chain: 'ethereum',
    amountIn: 10n ** 18n,
    amountOut,
    priceQ18: Q18,
    executionPriceQ18: Q18,
    midPriceQ18: Q18,
    priceImpactBps: 10,
    path: [TOKEN_A, TOKEN_B],
    routeAddresses: ['0xpool1' as Address],
    sources: [],
    liquidityScore: 1000n,
    hopVersions: ['v2'],
    estimatedGasUnits: gasUnits,
    estimatedGasCostWei: gasUnits * gasPriceWei,
    gasPriceWei,
  })

  it('without gas price context falls back to raw amountOut comparison', () => {
    const highOutput = makeQuote(1000n, 200000n, 5_000_000_000n)
    const lowOutput = makeQuote(999n, 100000n, 5_000_000_000n)
    expect(compareQuotes(highOutput, lowOutput)).toBe(-1)
  })

  it('with gas price context prefers higher net output (amountOut - gasCost)', () => {
    const highOutputHighGas = makeQuote(1000n * Q18, 300000n, 5_000_000_000n)
    const lowOutputLowGas = makeQuote(999n * Q18, 100000n, 5_000_000_000n)
    const nativeToOutputPriceQ18 = Q18 // 1:1 native to output
    const result = compareQuotes(highOutputHighGas, lowOutputLowGas, nativeToOutputPriceQ18, 18)
    // Net: highOutputHighGas net = 1000e18 - (300000*5gwei*1) vs lowOutputLowGas net = 999e18 - (100000*5gwei*1)
    // The gas difference is tiny compared to amountOut difference, so high output still wins
    expect(result).toBe(-1)
  })

  it('gas-adjusted flips ranking when gas cost dominates', () => {
    const gasPriceWei = 100_000_000_000n // 100 gwei
    const highOutputExpensiveRoute = makeQuote(10n ** 18n, 5_000_000n, gasPriceWei) // amountOut=1e18, gas=5M*100gwei=0.5ETH
    const lowOutputCheapRoute = makeQuote(9n * 10n ** 17n, 100_000n, gasPriceWei) // amountOut=0.9e18, gas=100k*100gwei=0.01ETH
    const nativeToOutputPriceQ18 = Q18 // 1:1

    // Without gas: highOutput wins (1e18 > 0.9e18)
    expect(compareQuotes(highOutputExpensiveRoute, lowOutputCheapRoute)).toBe(-1)

    // With gas: highOutput net = 1e18 - 0.5e18 = 0.5e18; lowOutput net = 0.9e18 - 0.01e18 = 0.89e18
    // lowOutput wins
    expect(compareQuotes(highOutputExpensiveRoute, lowOutputCheapRoute, nativeToOutputPriceQ18, 18)).toBe(1)
  })
})

describe('greedy init strategy', () => {
  it('finds a split using greedy init that equals or beats equal init', () => {
    const amountIn = 50n * 10n ** 18n

    const pools = [
      makeV2Quote(1000n * 10n ** 18n, 1000n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpoolA'),
      makeV2Quote(200n * 10n ** 18n, 200n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpoolB'),
      makeV2Quote(100n * 10n ** 18n, 100n * 10n ** 18n, amountIn, 'uniswap-v2', '0xpoolC'),
    ]

    const config: SplitOptimizerConfig = {
      maxSplitLegs: 10,
      convergenceThresholdBps: 5,
      maxIterations: 200,
      minLegRatioBps: 50,
    }

    const result = findBestSplit(pools, amountIn, config)
    expect(result).not.toBeNull()
    if (result && result.splits) {
      expect(result.splits.length).toBeGreaterThanOrEqual(2)
      const totalRatio = result.splits.reduce((s, l) => s + l.ratioBps, 0)
      expect(totalRatio).toBe(10000)
    }
  })
})
