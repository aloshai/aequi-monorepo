import type { PriceQuote, SplitLeg } from '@aequi/core'
import { recomputeQuoteForAmount, estimateGasForRoute, computeExecutionPriceQ18 } from './quote-math'
import { chainMultiplyQ18, minBigInt } from './math'

const GAS_PER_SPLIT_OVERHEAD = 80000n

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

const generateSplitRatios = (splitCount: number): number[][] => {
  const step = 1000 // 10% in BPS
  const total = 10000

  if (splitCount === 2) {
    const combos: number[][] = []
    for (let a = step; a <= total - step; a += step) {
      combos.push([a, total - a])
    }
    return combos
  }

  if (splitCount === 3) {
    const combos: number[][] = []
    for (let a = step; a <= total - 2 * step; a += step) {
      for (let b = step; b <= total - a - step; b += step) {
        const c = total - a - b
        if (c >= step) {
          combos.push([a, b, c])
        }
      }
    }
    return combos
  }

  return []
}

export interface SplitOptimizerConfig {
  maxSplitLegs: number
  minSplitAmountThreshold?: bigint
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
  const routes = deduplicateRoutes(candidates, 5)
  if (routes.length < 2) return null

  let bestAmountOut = 0n
  let bestSplits: SplitLeg[] | null = null
  let bestGasUnits = 0n

  // 2-way splits
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const routeA = routes[i]!
      const routeB = routes[j]!

      for (const [ratioA, ratioB] of generateSplitRatios(2)) {
        const amountA = (amountIn * BigInt(ratioA!)) / 10000n
        const amountB = amountIn - amountA

        const recomputedA = recomputeQuoteForAmount(routeA, amountA)
        const recomputedB = recomputeQuoteForAmount(routeB, amountB)
        if (!recomputedA || !recomputedB) continue

        const totalOut = recomputedA.amountOut + recomputedB.amountOut
        if (totalOut > bestAmountOut) {
          bestAmountOut = totalOut
          bestSplits = [
            { quote: recomputedA, ratioBps: ratioA! },
            { quote: recomputedB, ratioBps: ratioB! },
          ]
          bestGasUnits = (recomputedA.estimatedGasUnits ?? 0n) +
            (recomputedB.estimatedGasUnits ?? 0n) +
            GAS_PER_SPLIT_OVERHEAD
        }
      }
    }
  }

  // 3-way splits
  if (maxLegs >= 3 && routes.length >= 3) {
    const threeWayRatios = generateSplitRatios(3)
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        for (let k = j + 1; k < routes.length; k++) {
          const routeA = routes[i]!
          const routeB = routes[j]!
          const routeC = routes[k]!

          for (const [ratioA, ratioB, ratioC] of threeWayRatios) {
            const amountA = (amountIn * BigInt(ratioA!)) / 10000n
            const amountB = (amountIn * BigInt(ratioB!)) / 10000n
            const amountC = amountIn - amountA - amountB

            const recomputedA = recomputeQuoteForAmount(routeA, amountA)
            const recomputedB = recomputeQuoteForAmount(routeB, amountB)
            const recomputedC = recomputeQuoteForAmount(routeC, amountC)
            if (!recomputedA || !recomputedB || !recomputedC) continue

            const totalOut = recomputedA.amountOut + recomputedB.amountOut + recomputedC.amountOut
            if (totalOut > bestAmountOut) {
              bestAmountOut = totalOut
              bestSplits = [
                { quote: recomputedA, ratioBps: ratioA! },
                { quote: recomputedB, ratioBps: ratioB! },
                { quote: recomputedC, ratioBps: ratioC! },
              ]
              bestGasUnits = (recomputedA.estimatedGasUnits ?? 0n) +
                (recomputedB.estimatedGasUnits ?? 0n) +
                (recomputedC.estimatedGasUnits ?? 0n) +
                GAS_PER_SPLIT_OVERHEAD * 2n
            }
          }
        }
      }
    }
  }

  if (!bestSplits || bestAmountOut === 0n) return null

  const bestSingle = candidates[0]!
  if (bestAmountOut <= bestSingle.amountOut) return null

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

  const gasPriceWei = primaryLeg.gasPriceWei
  const estimatedGasCostWei = gasPriceWei ? bestGasUnits * gasPriceWei : null

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
