import type { PriceQuote, SplitLeg } from '@aequi/core'
import { recomputeQuoteForAmount, computeExecutionPriceQ18 } from './quote-math'
import { Q18 } from './math'
import { marginalOutputForQuote } from './marginal'

const GAS_PER_SPLIT_OVERHEAD = 80000n
const Q128 = 1n << 128n
const MIN_ALLOCATION = 1n

const routeSignature = (quote: PriceQuote): string =>
  quote.sources.map((s) => `${s.dexId}:${s.poolAddress}`).join('|')

const deduplicateRoutes = (quotes: PriceQuote[], maxRoutes: number): PriceQuote[] => {
  const seen = new Set<string>()
  const unique: PriceQuote[] = []
  for (const q of quotes) {
    const sig = routeSignature(q)
    if (seen.has(sig)) continue
    seen.add(sig)
    unique.push(q)
    if (unique.length >= maxRoutes) break
  }
  return unique
}

export interface SplitOptimizerConfig {
  maxSplitLegs: number
  minSplitAmountThreshold?: bigint
  convergenceThresholdBps?: number
  maxIterations?: number
  minLegRatioBps?: number
  nativeToOutputPriceQ18?: bigint
}

const convertGasToOutputUnits = (
  gasCostWei: bigint,
  outputDecimals: number,
  nativeToOutputPriceQ18: bigint,
): bigint => {
  if (nativeToOutputPriceQ18 <= 0n || gasCostWei <= 0n) return 0n
  const outputFactor = 10n ** BigInt(outputDecimals)
  // gasCostWei is in native token units (18 decimals)
  // nativeToOutputPriceQ18 = how many output tokens per 1 native token (Q18 scaled)
  // result = gasCostWei * price * outputFactor / (Q18 * nativeFactor)
  // Since native is always 18 decimals, nativeFactor = Q18, they cancel
  return (gasCostWei * nativeToOutputPriceQ18 * outputFactor) / (Q18 * Q18)
}

interface LegState {
  route: PriceQuote
  allocated: bigint
  recomputed: PriceQuote | null
  marginal: bigint
}

const optimizeSplitMPE = (
  routes: PriceQuote[],
  amountIn: bigint,
  convergenceThresholdBps: number,
  maxIterations: number,
  minLegRatioBps: number,
): { legs: LegState[]; totalOut: bigint } | null => {
  const n = routes.length
  if (n < 2 || amountIn <= 0n) return null

  const minAllocation = (amountIn * BigInt(minLegRatioBps)) / 10000n

  // Initialize: equal distribution
  const legs: LegState[] = []
  const baseAlloc = amountIn / BigInt(n)
  let allocated = 0n

  for (let i = 0; i < n; i++) {
    const alloc = i === n - 1 ? amountIn - allocated : baseAlloc
    allocated += alloc
    legs.push({
      route: routes[i]!,
      allocated: alloc,
      recomputed: null,
      marginal: 0n,
    })
  }

  // Recompute initial state
  for (const leg of legs) {
    leg.recomputed = recomputeQuoteForAmount(leg.route, leg.allocated)
    if (!leg.recomputed) return null
    leg.marginal = marginalOutputForQuote(leg.route, leg.allocated)
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    // Find legs with highest and lowest marginal output
    let highIdx = 0
    let lowIdx = 0
    let highMarginal = legs[0]!.marginal
    let lowMarginal = legs[0]!.marginal

    for (let i = 1; i < legs.length; i++) {
      if (legs[i]!.marginal > highMarginal) {
        highMarginal = legs[i]!.marginal
        highIdx = i
      }
      if (legs[i]!.marginal < lowMarginal) {
        lowMarginal = legs[i]!.marginal
        lowIdx = i
      }
    }

    if (highIdx === lowIdx) break

    // Convergence check: marginal spread relative to average
    if (highMarginal <= 0n) break
    const spread = ((highMarginal - lowMarginal) * 10000n) / highMarginal
    if (spread <= BigInt(convergenceThresholdBps)) break

    // Transfer amount: proportional to marginal difference
    // Use a damped step: move ~30% of the gap to avoid oscillation
    const transferBase = (amountIn * spread) / (10000n * 3n)
    const transfer = transferBase > MIN_ALLOCATION ? transferBase : MIN_ALLOCATION

    // Transfer from low-marginal (overallocated) to high-marginal (underallocated)
    const actualTransfer = (() => {
      const maxFromLow = legs[lowIdx]!.allocated - minAllocation
      if (maxFromLow <= 0n) return 0n
      return transfer < maxFromLow ? transfer : maxFromLow
    })()

    if (actualTransfer <= 0n) break

    legs[lowIdx]!.allocated -= actualTransfer
    legs[highIdx]!.allocated += actualTransfer

    // Recompute affected legs
    for (const idx of [lowIdx, highIdx]) {
      const leg = legs[idx]!
      leg.recomputed = recomputeQuoteForAmount(leg.route, leg.allocated)
      if (!leg.recomputed) return null
      leg.marginal = marginalOutputForQuote(leg.route, leg.allocated)
    }
  }

  // Prune legs that fell below minimum
  const activelegs = legs.filter((l) => l.allocated >= minAllocation && l.recomputed)
  if (activelegs.length < 2) return null

  // Redistribute pruned amounts proportionally
  const activeTotal = activelegs.reduce((sum, l) => sum + l.allocated, 0n)
  if (activeTotal < amountIn) {
    const remainder = amountIn - activeTotal
    // Give remainder to the leg with highest marginal output
    const bestLeg = activelegs.reduce((best, l) => l.marginal > best.marginal ? l : best)
    bestLeg.allocated += remainder
    bestLeg.recomputed = recomputeQuoteForAmount(bestLeg.route, bestLeg.allocated)
    if (!bestLeg.recomputed) return null
  }

  const totalOut = activelegs.reduce((sum, l) => sum + l.recomputed!.amountOut, 0n)
  return { legs: activelegs, totalOut }
}

export const findBestSplit = (
  candidates: PriceQuote[],
  amountIn: bigint,
  config: SplitOptimizerConfig,
): PriceQuote | null => {
  if (candidates.length < 2) return null

  if (config.minSplitAmountThreshold && amountIn < config.minSplitAmountThreshold) {
    return null
  }

  const maxLegs = Math.min(Math.max(config.maxSplitLegs, 2), 5)
  const convergenceThresholdBps = config.convergenceThresholdBps ?? 10
  const maxIterations = config.maxIterations ?? 50
  const minLegRatioBps = config.minLegRatioBps ?? 50

  const routes = deduplicateRoutes(candidates, 7)
  if (routes.length < 2) return null

  let bestAmountOut = 0n
  let bestSplits: SplitLeg[] | null = null
  let bestGasUnits = 0n

  const maxN = Math.min(maxLegs, routes.length)

  // Try N-way splits from 2 up to maxN
  for (let n = 2; n <= maxN; n++) {
    // Generate all combinations of n routes from available routes
    const combos = combinations(routes, n)

    for (const combo of combos) {
      const result = optimizeSplitMPE(combo, amountIn, convergenceThresholdBps, maxIterations, minLegRatioBps)
      if (!result) continue

      if (result.totalOut > bestAmountOut) {
        bestAmountOut = result.totalOut

        // Compute BPS ratios from actual allocations
        const totalAlloc = result.legs.reduce((s, l) => s + l.allocated, 0n)
        let bpsAssigned = 0

        bestSplits = result.legs.map((leg, idx) => {
          const isLast = idx === result.legs.length - 1
          const ratioBps = isLast
            ? 10000 - bpsAssigned
            : Number((leg.allocated * 10000n) / totalAlloc)
          bpsAssigned += ratioBps
          return { quote: leg.recomputed!, ratioBps }
        })

        bestGasUnits = result.legs.reduce(
          (sum, l) => sum + (l.recomputed!.estimatedGasUnits ?? 0n),
          0n,
        ) + GAS_PER_SPLIT_OVERHEAD * BigInt(n - 1)
      }
    }
  }

  if (!bestSplits || bestAmountOut === 0n) return null

  const bestSingle = candidates[0]!
  if (bestAmountOut <= bestSingle.amountOut) return null

  // Gas-adjusted comparison
  const gasPriceWei = bestSingle.gasPriceWei ?? 0n
  if (gasPriceWei > 0n) {
    const singleGasUnits = bestSingle.estimatedGasUnits ?? 0n
    const extraGasWei = bestGasUnits > singleGasUnits
      ? (bestGasUnits - singleGasUnits) * gasPriceWei
      : 0n

    if (extraGasWei > 0n) {
      const outputAdvantage = bestAmountOut - bestSingle.amountOut
      const outputToken = bestSingle.path[bestSingle.path.length - 1]!

      if (config.nativeToOutputPriceQ18 && config.nativeToOutputPriceQ18 > 0n) {
        const extraGasInOutputUnits = convertGasToOutputUnits(
          extraGasWei,
          outputToken.decimals,
          config.nativeToOutputPriceQ18,
        )
        if (outputAdvantage <= extraGasInOutputUnits) return null
      } else {
        // Fallback: if output token is 18 decimals (likely wrapped native), compare directly
        if (outputToken.decimals === 18 && outputAdvantage <= extraGasWei) return null
      }
    }
  }

  // Sort legs by ratio descending — primary leg first
  bestSplits.sort((a, b) => b.ratioBps - a.ratioBps)
  const primaryLeg = bestSplits[0]!.quote

  const firstToken = primaryLeg.path[0]!
  const lastToken = primaryLeg.path[primaryLeg.path.length - 1]!

  const executionPriceQ18 = computeExecutionPriceQ18(
    amountIn,
    bestAmountOut,
    firstToken.decimals,
    lastToken.decimals,
  )

  const primaryGasPriceWei = primaryLeg.gasPriceWei
  const estimatedGasCostWei = primaryGasPriceWei ? bestGasUnits * primaryGasPriceWei : null

  const weightedImpact = bestSplits.reduce(
    (acc, leg) => acc + leg.quote.priceImpactBps * leg.ratioBps,
    0,
  ) / 10000

  return {
    chain: primaryLeg.chain,
    amountIn,
    amountOut: bestAmountOut,
    priceQ18: executionPriceQ18,
    executionPriceQ18,
    midPriceQ18: primaryLeg.midPriceQ18,
    priceImpactBps: Math.round(weightedImpact),
    path: primaryLeg.path,
    routeAddresses: primaryLeg.routeAddresses,
    sources: primaryLeg.sources,
    liquidityScore: bestSplits.reduce(
      (acc, leg) => acc + leg.quote.liquidityScore,
      0n,
    ),
    hopVersions: primaryLeg.hopVersions,
    estimatedGasUnits: bestGasUnits,
    estimatedGasCostWei,
    gasPriceWei,
    isSplit: true,
    splits: bestSplits,
  }
}

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 1) {
    for (const item of arr) yield [item]
    return
  }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i]!, ...rest]
    }
  }
}
