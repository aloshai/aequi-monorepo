import { CurrencyAmount as CakeCurrencyAmount, Token as CakeToken } from '@pancakeswap/swap-sdk-core'
import { CurrencyAmount as UniCurrencyAmount, Token as UniToken } from '@uniswap/sdk-core'
import type { DexConfig, PriceQuote, PriceSource, RouteHopVersion } from '@aequi/core'
import { Q18, multiplyQ18 } from './math'

export const V2_FEE_NUMERATOR: Record<string, bigint> = {
  uniswap: 997n,
  pancakeswap: 9975n,
}

const V2_FEE_DENOMINATOR: Record<string, bigint> = {
  uniswap: 1000n,
  pancakeswap: 10000n,
}

export const getV2AmountOut = (
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  protocol: string = 'uniswap',
): bigint => {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) {
    return 0n
  }
  const feeNum = V2_FEE_NUMERATOR[protocol] ?? 997n
  const feeDen = V2_FEE_DENOMINATOR[protocol] ?? 1000n
  const amountInWithFee = amountIn * feeNum
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * feeDen + amountInWithFee
  if (denominator === 0n) {
    return 0n
  }
  return numerator / denominator
}

export const computeMidPriceQ18FromReserves = (
  protocol: DexConfig['protocol'],
  reserveIn: bigint,
  reserveOut: bigint,
  inDecimals: number,
  outDecimals: number,
): bigint => {
  if (reserveIn === 0n || reserveOut === 0n) {
    return 0n
  }
  const inFactor = pow10(inDecimals)
  const outFactor = pow10(outDecimals)
  if (inFactor === 0n || outFactor === 0n) {
    return 0n
  }
  return (reserveOut * Q18 * inFactor) / (reserveIn * outFactor)
}

const pow10 = (value: number) => {
  if (value < 0) return 1n
  try {
    return 10n ** BigInt(value)
  } catch (error) {
    console.error(`[QuoteMath] Failed to compute pow10 for value: ${value}`)
    throw error
  }
}

const buildCurrencyAmount = (
  protocol: DexConfig['protocol'],
  token: UniToken | CakeToken,
  rawAmount: bigint,
) => {
  const value = rawAmount.toString()
  return protocol === 'uniswap'
    ? UniCurrencyAmount.fromRawAmount(token as UniToken, value)
    : CakeCurrencyAmount.fromRawAmount(token as CakeToken, value)
}

export const computeMidPriceQ18FromPrice = (
  protocol: DexConfig['protocol'],
  tokenInInstance: UniToken | CakeToken,
  tokenOutDecimals: number,
  price: { quote(input: unknown): unknown },
): bigint => {
  const unitIn = pow10(tokenInInstance.decimals)
  if (unitIn === 0n) {
    return 0n
  }

  try {
    const baseAmount = buildCurrencyAmount(protocol, tokenInInstance, unitIn)
    const quoted = price.quote(baseAmount as any)
    const quoteRaw = toRawAmount(quoted)
    if (quoteRaw === 0n) {
      return 0n
    }

    const outFactor = pow10(tokenOutDecimals)
    if (outFactor === 0n) {
      return 0n
    }

    return (quoteRaw * Q18) / outFactor
  } catch {
    return 0n
  }
}

export const applyPriceQ18 = (
  priceQ18: bigint,
  amountIn: bigint,
  inDecimals: number,
  outDecimals: number,
): bigint => {
  if (priceQ18 === 0n || amountIn === 0n) {
    return 0n
  }

  const inFactor = pow10(inDecimals)
  const outFactor = pow10(outDecimals)
  const numerator = amountIn * priceQ18 * outFactor
  const denominator = Q18 * inFactor
  if (denominator === 0n) {
    return 0n
  }

  return numerator / denominator
}

export const computeExecutionPriceQ18 = (
  amountIn: bigint,
  amountOut: bigint,
  inDecimals: number,
  outDecimals: number,
): bigint => {
  if (amountIn === 0n || amountOut === 0n) {
    return 0n
  }
  const inFactor = pow10(inDecimals)
  const outFactor = pow10(outDecimals)
  const denominator = amountIn * outFactor
  if (denominator === 0n) {
    return 0n
  }

  return (amountOut * Q18 * inFactor) / denominator
}

export const computePriceImpactBps = (
  midPriceQ18: bigint,
  amountIn: bigint,
  amountOut: bigint,
  inDecimals: number,
  outDecimals: number,
): number => {
  if (midPriceQ18 === 0n || amountIn === 0n || amountOut === 0n) {
    return 0
  }

  const expectedOut = applyPriceQ18(midPriceQ18, amountIn, inDecimals, outDecimals)
  if (expectedOut === 0n) {
    return 0
  }

  if (amountOut >= expectedOut) {
    return 0
  }

  const diff = expectedOut - amountOut
  const impact = (diff * 10000n) / expectedOut
  const capped = impact > 10000n ? 10000n : impact
  return Number(capped)
}

export const toRawAmount = (amount: unknown): bigint => {
  try {
    const quotient = (amount as { quotient: { toString(): string } }).quotient.toString()
    return BigInt(quotient)
  } catch (error) {
    console.error('[QuoteMath] Failed to convert amount to BigInt:', amount)
    throw error
  }
}

export const estimateAmountOutFromMidPrice = (
  midPriceQ18: bigint,
  amountIn: bigint,
  inDecimals: number,
  outDecimals: number,
  fee: number,
): bigint => {
  if (midPriceQ18 === 0n || amountIn === 0n) {
    return 0n
  }

  const adjustedAmountIn = amountIn - (amountIn * BigInt(fee)) / 1_000_000n
  return applyPriceQ18(midPriceQ18, adjustedAmountIn, inDecimals, outDecimals)
}

export const compareQuotes = (a: PriceQuote, b: PriceQuote) => {
  if (a.amountOut !== b.amountOut) {
    return a.amountOut > b.amountOut ? -1 : 1
  }
  
  const aHasGas = a.estimatedGasCostWei !== undefined && a.estimatedGasCostWei !== null
  const bHasGas = b.estimatedGasCostWei !== undefined && b.estimatedGasCostWei !== null
  if (aHasGas && bHasGas) {
    if (a.estimatedGasCostWei! !== b.estimatedGasCostWei!) {
      return a.estimatedGasCostWei! < b.estimatedGasCostWei! ? -1 : 1
    }
  } else if (aHasGas !== bHasGas) {
    return aHasGas ? -1 : 1
  }
  
  if (a.liquidityScore !== b.liquidityScore) {
    return a.liquidityScore > b.liquidityScore ? -1 : 1
  }
  
  return a.priceImpactBps <= b.priceImpactBps ? -1 : 1
}

export const estimateGasForRoute = (hops: RouteHopVersion[]): bigint => {
  const GAS_BASE = 50000n
  const GAS_MULTI_HOP_OVERHEAD = 20000n
  const GAS_COSTS: Record<RouteHopVersion, bigint> = {
    v2: 70000n,
    v3: 110000n,
  }

  if (!hops.length) {
    return GAS_BASE
  }
  const base = hops.reduce((total, hop) => total + (GAS_COSTS[hop] ?? 90000n), GAS_BASE)
  if (hops.length === 1) {
    return base
  }
  return base + BigInt(hops.length - 1) * GAS_MULTI_HOP_OVERHEAD
}

export const multiplyQuotePrices = (a: PriceQuote, b: PriceQuote): { mid: bigint; execution: bigint } => {
  return {
    mid: multiplyQ18(a.midPriceQ18, b.midPriceQ18),
    execution: multiplyQ18(a.executionPriceQ18, b.executionPriceQ18),
  }
}

export const recomputeQuoteForAmount = (
  original: PriceQuote,
  newAmountIn: bigint,
): PriceQuote | null => {
  if (newAmountIn <= 0n || !original.sources.length || original.path.length < 2) {
    return null
  }

  const newSources: PriceSource[] = []
  let rollingAmountIn = newAmountIn

  for (let i = 0; i < original.sources.length; i++) {
    const source = original.sources[i]!
    const tokenIn = original.path[i]!
    const tokenOut = original.path[i + 1]!

    if (!source.reserves) return null

    let amountOut: bigint

    if (source.reserves.reserve0 !== undefined && source.reserves.reserve1 !== undefined && source.reserves.token0) {
      const isToken0In = tokenIn.address.toLowerCase() === source.reserves.token0.toLowerCase()
      const reserveIn = isToken0In ? source.reserves.reserve0 : source.reserves.reserve1
      const reserveOut = isToken0In ? source.reserves.reserve1 : source.reserves.reserve0
      const protocol = source.dexId.startsWith('pancake') ? 'pancakeswap' : 'uniswap'
      amountOut = getV2AmountOut(rollingAmountIn, reserveIn, reserveOut, protocol)
    } else if (
      source.reserves.liquidity !== undefined && source.reserves.liquidity > 0n &&
      source.reserves.sqrtPriceX96 !== undefined && source.reserves.sqrtPriceX96 > 0n &&
      source.reserves.token0
    ) {
      const zeroForOne = tokenIn.address.toLowerCase() === source.reserves.token0.toLowerCase()
      const fee = source.feeTier ?? 3000
      amountOut = estimateV3AmountOut(source.reserves.sqrtPriceX96, source.reserves.liquidity, rollingAmountIn, fee, zeroForOne)
    } else if (source.reserves.liquidity !== undefined && source.reserves.liquidity > 0n) {
      if (source.amountIn === 0n || source.amountOut === 0n) return null
      amountOut = (rollingAmountIn * source.amountOut) / source.amountIn
    } else {
      return null
    }

    if (amountOut <= 0n) return null

    newSources.push({
      ...source,
      amountIn: rollingAmountIn,
      amountOut,
    })

    rollingAmountIn = amountOut
  }

  const firstToken = original.path[0]!
  const lastToken = original.path[original.path.length - 1]!
  const totalAmountOut = newSources[newSources.length - 1]!.amountOut

  const executionPriceQ18 = computeExecutionPriceQ18(
    newAmountIn,
    totalAmountOut,
    firstToken.decimals,
    lastToken.decimals,
  )

  const priceImpactBps = computePriceImpactBps(
    original.midPriceQ18,
    newAmountIn,
    totalAmountOut,
    firstToken.decimals,
    lastToken.decimals,
  )

  const hopVersions = [...original.hopVersions]
  const estimatedGasUnits = estimateGasForRoute(hopVersions)
  const estimatedGasCostWei = original.gasPriceWei ? estimatedGasUnits * original.gasPriceWei : null

  return {
    ...original,
    amountIn: newAmountIn,
    amountOut: totalAmountOut,
    priceQ18: executionPriceQ18,
    executionPriceQ18,
    priceImpactBps,
    sources: newSources,
    hopVersions,
    estimatedGasUnits,
    estimatedGasCostWei,
    offers: undefined,
    isSplit: undefined,
    splits: undefined,
  }
}

const Q96 = 1n << 96n

export const estimateV3AmountOut = (
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  fee: number,
  zeroForOne: boolean,
): bigint => {
  if (sqrtPriceX96 === 0n || liquidity === 0n || amountIn === 0n) return 0n

  const amountInAfterFee = (amountIn * BigInt(1_000_000 - fee)) / 1_000_000n
  if (amountInAfterFee <= 0n) return 0n

  if (zeroForOne) {
    const numerator1 = liquidity << 96n
    const denominator = numerator1 + amountInAfterFee * sqrtPriceX96
    if (denominator === 0n) return 0n
    const sqrtPriceNextX96 = (numerator1 * sqrtPriceX96) / denominator
    if (sqrtPriceNextX96 >= sqrtPriceX96) return 0n
    return (liquidity * (sqrtPriceX96 - sqrtPriceNextX96)) / Q96
  }

  const sqrtPriceNextX96 = sqrtPriceX96 + (amountInAfterFee << 96n) / liquidity
  if (sqrtPriceNextX96 <= sqrtPriceX96 || sqrtPriceNextX96 === 0n) return 0n
  const num = liquidity * Q96
  return (num / sqrtPriceX96) - (num / sqrtPriceNextX96)
}

export const computeV3MidPriceQ18FromSqrtPrice = (
  sqrtPriceX96: bigint,
  zeroForOne: boolean,
  inDecimals: number,
  outDecimals: number,
): bigint => {
  if (sqrtPriceX96 === 0n) return 0n

  const Q192 = Q96 * Q96
  const inFactor = 10n ** BigInt(inDecimals)
  const outFactor = 10n ** BigInt(outDecimals)

  if (zeroForOne) {
    return (sqrtPriceX96 * sqrtPriceX96 * Q18 * inFactor) / (Q192 * outFactor)
  }

  const priceSq = sqrtPriceX96 * sqrtPriceX96
  if (priceSq === 0n) return 0n
  return (Q192 * Q18 * inFactor) / (priceSq * outFactor)
}
