export { Q18, multiplyQ18, scaleToQ18, minBigInt } from '@aequi/pricing'

interface FractionLike {
  numerator: { toString(): string }
  denominator: { toString(): string }
}

export const fractionToQ18 = (fraction: FractionLike): bigint => {
  const numerator = BigInt(fraction.numerator.toString())
  const denominator = BigInt(fraction.denominator.toString())
  if (denominator === 0n) {
    return 0n
  }
  const Q18 = 10n ** 18n
  return (numerator * Q18) / denominator
}
