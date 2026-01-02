export const Q18 = 10n ** 18n

export const minBigInt = (a: bigint, b: bigint) => (a < b ? a : b)

export const scaleToQ18 = (amount: bigint, decimals: number): bigint => {
  if (decimals < 0) {
    return 0n
  }
  const factor = 10n ** BigInt(decimals)
  if (factor === 0n) {
    return 0n
  }
  return (amount * Q18) / factor
}

export const multiplyQ18 = (a: bigint, b: bigint): bigint => (a === 0n || b === 0n ? 0n : (a * b) / Q18)
