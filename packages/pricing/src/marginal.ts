import type { PriceQuote } from '@aequi/core'
import { V2_FEE_NUMERATOR, estimateV3AmountOut, getV2AmountOut } from './quote-math'

const V2_FEE_DENOMINATOR: Record<string, bigint> = {
  uniswap: 1000n,
  pancakeswap: 10000n,
}

const Q128 = 1n << 128n
const Q96 = 1n << 96n

export const marginalOutputV2 = (
  amountAllocated: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  protocol: string = 'uniswap',
): bigint => {
  if (reserveIn <= 0n || reserveOut <= 0n) return 0n

  const fn = V2_FEE_NUMERATOR[protocol] ?? 997n
  const fd = V2_FEE_DENOMINATOR[protocol] ?? 1000n

  // dy/dx = (Rout * fn * Rin * fd) / (Rin * fd + fn * x)^2
  // Scaled by Q128 for precision
  const denomRaw = reserveIn * fd + fn * amountAllocated
  if (denomRaw <= 0n) return 0n

  const numerator = reserveOut * fn * reserveIn * fd * Q128
  const denominator = denomRaw * denomRaw
  return numerator / denominator
}

export const marginalOutputV3 = (
  amountAllocated: bigint,
  sqrtPriceX96: bigint,
  liquidity: bigint,
  fee: number,
  zeroForOne: boolean,
): bigint => {
  if (sqrtPriceX96 <= 0n || liquidity <= 0n) return 0n

  const feeComplement = BigInt(1_000_000 - fee)
  const amountAfterFee = (amountAllocated * feeComplement) / 1_000_000n

  if (zeroForOne) {
    // dy/dx = (1-f) * L^2 * P^2 / ((L*2^96 + x'*P)^2 * 2^96)
    // Scaled by Q128
    const lShift = liquidity << 96n
    const denom = lShift + amountAfterFee * sqrtPriceX96
    if (denom <= 0n) return 0n

    const num = feeComplement * liquidity * liquidity * sqrtPriceX96 * sqrtPriceX96
    const denomSq = denom * denom
    const divisor = denomSq * Q96 * 1_000_000n
    if (divisor === 0n) return 0n

    return (num * Q128) / divisor
  }

  // !zeroForOne: dy/dx = (1-f) * L^2 * 2^192 / (L * P + x' * 2^96)^2 / P^2
  // Simplified: after fee adjustment on input
  const pTimesL = sqrtPriceX96 * liquidity
  const xShift = amountAfterFee << 96n
  const denom = pTimesL + xShift
  if (denom <= 0n) return 0n

  const Q192 = Q96 * Q96
  const num = feeComplement * liquidity * liquidity * Q192
  const denomSq = denom * denom
  const divisor = denomSq * 1_000_000n
  if (divisor === 0n) return 0n

  return (num * Q128) / divisor
}

export const marginalOutputForQuote = (
  quote: PriceQuote,
  amountAllocated: bigint,
): bigint => {
  if (amountAllocated <= 0n || !quote.sources.length || quote.path.length < 2) return 0n

  let rollingAmount = amountAllocated
  let chainedMarginal = Q128

  for (let i = 0; i < quote.sources.length; i++) {
    const source = quote.sources[i]!
    const tokenIn = quote.path[i]!

    if (!source.reserves) return 0n

    let hopMarginal: bigint
    let hopOutput: bigint

    if (source.reserves.reserve0 !== undefined && source.reserves.reserve1 !== undefined && source.reserves.token0) {
      const isToken0In = tokenIn.address.toLowerCase() === source.reserves.token0.toLowerCase()
      const reserveIn = isToken0In ? source.reserves.reserve0 : source.reserves.reserve1
      const reserveOut = isToken0In ? source.reserves.reserve1 : source.reserves.reserve0
      const protocol = source.dexId.startsWith('pancake') ? 'pancakeswap' : 'uniswap'

      hopMarginal = marginalOutputV2(rollingAmount, reserveIn, reserveOut, protocol)
      hopOutput = getV2AmountOut(rollingAmount, reserveIn, reserveOut, protocol)
    } else if (
      source.reserves.liquidity !== undefined && source.reserves.liquidity > 0n &&
      source.reserves.sqrtPriceX96 !== undefined && source.reserves.sqrtPriceX96 > 0n &&
      source.reserves.token0
    ) {
      const zeroForOne = tokenIn.address.toLowerCase() === source.reserves.token0.toLowerCase()
      const fee = source.feeTier ?? 3000

      hopMarginal = marginalOutputV3(rollingAmount, source.reserves.sqrtPriceX96, source.reserves.liquidity, fee, zeroForOne)
      hopOutput = estimateV3AmountOut(source.reserves.sqrtPriceX96, source.reserves.liquidity, rollingAmount, fee, zeroForOne)
    } else {
      return 0n
    }

    if (hopOutput <= 0n) return 0n

    // Chain rule: total marginal = product of per-hop marginals
    chainedMarginal = (chainedMarginal * hopMarginal) / Q128
    rollingAmount = hopOutput
  }

  return chainedMarginal
}
