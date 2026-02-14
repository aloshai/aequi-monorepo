import type { PriceQuote, SplitLeg } from '@aequi/core'
import { recomputeQuoteForAmount, computeExecutionPriceQ18, convertGasToOutputUnits } from './quote-math'
import { Q18 } from './math'
import { marginalOutputForQuote } from './marginal'

const GAS_PER_SPLIT_OVERHEAD = 80000n
const Q128 = 1n << 128n
const MIN_ALLOCATION = 1n
const MAX_ROUTES_CAP = 20

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
  initialAllocations?: bigint[],
): { legs: LegState[]; totalOut: bigint } | null => {
  if (routes.length < 2 || amountIn <= 0n) return null

  const minAllocation = (amountIn * BigInt(minLegRatioBps)) / 10000n

  const n = routes.length
  const initLegs: LegState[] = []

  if (initialAllocations && initialAllocations.length === n) {
    for (let i = 0; i < n; i++) {
      initLegs.push({ route: routes[i]!, allocated: initialAllocations[i]!, recomputed: null, marginal: 0n })
    }
  } else {
    const baseAlloc = amountIn / BigInt(n)
    let totalAllocated = 0n
    for (let i = 0; i < n; i++) {
      const alloc = i === n - 1 ? amountIn - totalAllocated : baseAlloc
      totalAllocated += alloc
      initLegs.push({ route: routes[i]!, allocated: alloc, recomputed: null, marginal: 0n })
    }
  }

  // Recompute — remove legs that fail at initial allocation
  const legs: LegState[] = []
  let failedAlloc = 0n

  for (const leg of initLegs) {
    leg.recomputed = recomputeQuoteForAmount(leg.route, leg.allocated)
    if (leg.recomputed) {
      leg.marginal = marginalOutputForQuote(leg.route, leg.allocated)
      legs.push(leg)
    } else {
      failedAlloc += leg.allocated
    }
  }

  if (legs.length < 2) return null

  // Redistribute failed allocations to best remaining legs
  if (failedAlloc > 0n) {
    legs.sort((a, b) => (b.marginal > a.marginal ? 1 : -1))
    legs[0]!.allocated += failedAlloc
    legs[0]!.recomputed = recomputeQuoteForAmount(legs[0]!.route, legs[0]!.allocated)
    if (!legs[0]!.recomputed) return null
    legs[0]!.marginal = marginalOutputForQuote(legs[0]!.route, legs[0]!.allocated)
  }

  // MPE iteration loop — pairwise transfer from worst to best marginal
  for (let iter = 0; iter < maxIterations; iter++) {
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
    if (highMarginal <= 0n) break

    const spread = ((highMarginal - lowMarginal) * 10000n) / highMarginal
    if (spread <= BigInt(convergenceThresholdBps)) break

    const transferBase = (amountIn * spread) / (10000n * 2n)
    const transfer = transferBase > MIN_ALLOCATION ? transferBase : MIN_ALLOCATION

    const maxFromLow = legs[lowIdx]!.allocated - minAllocation
    const actualTransfer = maxFromLow <= 0n ? 0n : (transfer < maxFromLow ? transfer : maxFromLow)
    if (actualTransfer <= 0n) {
      // Low leg is at minimum — try removing it entirely
      if (legs.length > 2) {
        const removed = legs.splice(lowIdx, 1)[0]!
        // Give removed allocation to highest marginal leg
        const newHighIdx = legs.findIndex((l) => l.marginal === highMarginal) 
        const targetIdx = newHighIdx >= 0 ? newHighIdx : 0
        legs[targetIdx]!.allocated += removed.allocated
        legs[targetIdx]!.recomputed = recomputeQuoteForAmount(legs[targetIdx]!.route, legs[targetIdx]!.allocated)
        if (!legs[targetIdx]!.recomputed) return null
        legs[targetIdx]!.marginal = marginalOutputForQuote(legs[targetIdx]!.route, legs[targetIdx]!.allocated)
        continue
      }
      break
    }

    legs[lowIdx]!.allocated -= actualTransfer
    legs[highIdx]!.allocated += actualTransfer

    for (const idx of [lowIdx, highIdx]) {
      const leg = legs[idx]!
      leg.recomputed = recomputeQuoteForAmount(leg.route, leg.allocated)
      if (!leg.recomputed) return null
      leg.marginal = marginalOutputForQuote(leg.route, leg.allocated)
    }
  }

  // Final prune: remove legs below minimum, redistribute
  let pruned = true
  while (pruned) {
    pruned = false
    const weakIdx = legs.findIndex((l) => l.allocated < minAllocation)
    if (weakIdx >= 0 && legs.length > 2) {
      const removed = legs.splice(weakIdx, 1)[0]!
      const bestLeg = legs.reduce((best, l) => l.marginal > best.marginal ? l : best)
      bestLeg.allocated += removed.allocated
      bestLeg.recomputed = recomputeQuoteForAmount(bestLeg.route, bestLeg.allocated)
      if (!bestLeg.recomputed) return null
      bestLeg.marginal = marginalOutputForQuote(bestLeg.route, bestLeg.allocated)
      pruned = true
    }
  }

  if (legs.length < 2) return null

  const totalOut = legs.reduce((sum, l) => sum + l.recomputed!.amountOut, 0n)
  return { legs, totalOut }
}

const optimizeSplitMPEGreedy = (
  routes: PriceQuote[],
  amountIn: bigint,
  convergenceThresholdBps: number,
  maxIterations: number,
  minLegRatioBps: number,
): { legs: LegState[]; totalOut: bigint } | null => {
  if (routes.length < 2 || amountIn <= 0n) return null

  const sortedRoutes = [...routes].sort((a, b) =>
    a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0,
  )

  const sharePerLeg = 10000n / BigInt(sortedRoutes.length)
  const legs: LegState[] = []

  let remaining = amountIn
  legs.push({
    route: sortedRoutes[0]!,
    allocated: amountIn,
    recomputed: null,
    marginal: 0n,
  })

  for (let i = 1; i < sortedRoutes.length; i++) {
    const steal = (amountIn * sharePerLeg) / 10000n
    if (steal <= 0n) break

    const newLeg: LegState = {
      route: sortedRoutes[i]!,
      allocated: steal,
      recomputed: null,
      marginal: 0n,
    }

    newLeg.recomputed = recomputeQuoteForAmount(newLeg.route, steal)
    if (!newLeg.recomputed) continue

    legs[0]!.allocated -= steal
    remaining -= steal
    legs.push(newLeg)
  }

  if (legs.length < 2) return null

  for (const leg of legs) {
    leg.recomputed = recomputeQuoteForAmount(leg.route, leg.allocated)
    if (!leg.recomputed) return null
    leg.marginal = marginalOutputForQuote(leg.route, leg.allocated)
  }

  return optimizeSplitMPE(
    legs.map((l) => l.route),
    amountIn,
    convergenceThresholdBps,
    maxIterations,
    minLegRatioBps,
    legs.map((l) => l.allocated),
  )
}

const buildSplitResult = (
  result: { legs: LegState[]; totalOut: bigint },
): { splits: SplitLeg[]; gasUnits: bigint; amountOut: bigint } => {
  const totalAlloc = result.legs.reduce((s, l) => s + l.allocated, 0n)
  let bpsAssigned = 0

  const splits = result.legs.map((leg, idx) => {
    const isLast = idx === result.legs.length - 1
    const ratioBps = isLast
      ? 10000 - bpsAssigned
      : Number((leg.allocated * 10000n) / totalAlloc)
    bpsAssigned += ratioBps
    return { quote: leg.recomputed!, ratioBps }
  })

  const gasUnits = result.legs.reduce(
    (sum, l) => sum + (l.recomputed!.estimatedGasUnits ?? 0n),
    0n,
  ) + GAS_PER_SPLIT_OVERHEAD * BigInt(result.legs.length - 1)

  return { splits, gasUnits, amountOut: result.totalOut }
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

  const maxLegs = Math.min(Math.max(config.maxSplitLegs, 2), MAX_ROUTES_CAP)
  const convergenceThresholdBps = config.convergenceThresholdBps ?? 10
  const maxIterations = config.maxIterations ?? 100
  const minLegRatioBps = config.minLegRatioBps ?? 50

  const routes = deduplicateRoutes(candidates, MAX_ROUTES_CAP)
  if (routes.length < 2) return null

  let bestAmountOut = 0n
  let bestSplits: SplitLeg[] | null = null
  let bestGasUnits = 0n

  // Strategy 1: Exhaustive 2-way combinations (C(K,2) — always fast even with K=20)
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const result = optimizeSplitMPE(
        [routes[i]!, routes[j]!],
        amountIn, convergenceThresholdBps, maxIterations, minLegRatioBps,
      )
      if (!result || result.totalOut <= bestAmountOut) continue

      const built = buildSplitResult(result)
      bestAmountOut = built.amountOut
      bestSplits = built.splits
      bestGasUnits = built.gasUnits
    }
  }

  // Strategy 2: Full MPE with all routes — natural N-way discovery (single pass)
  if (routes.length >= 3 && maxLegs >= 3) {
    const fullRoutes = routes.slice(0, maxLegs)
    const result = optimizeSplitMPE(
      fullRoutes, amountIn, convergenceThresholdBps, maxIterations, minLegRatioBps,
    )

    if (result && result.legs.length <= maxLegs && result.totalOut > bestAmountOut) {
      const built = buildSplitResult(result)
      bestAmountOut = built.amountOut
      bestSplits = built.splits
      bestGasUnits = built.gasUnits
    }
  }

  // Strategy 3: Greedy init MPE — start heavy on best route, add legs iteratively
  if (routes.length >= 3 && maxLegs >= 3) {
    const greedyRoutes = routes.slice(0, maxLegs)
    const greedyResult = optimizeSplitMPEGreedy(
      greedyRoutes, amountIn, convergenceThresholdBps, maxIterations, minLegRatioBps,
    )
    if (greedyResult && greedyResult.legs.length <= maxLegs && greedyResult.totalOut > bestAmountOut) {
      const built = buildSplitResult(greedyResult)
      bestAmountOut = built.amountOut
      bestSplits = built.splits
      bestGasUnits = built.gasUnits
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
