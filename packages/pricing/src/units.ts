export const defaultAmountForDecimals = (decimals: number): bigint => {
  if (decimals < 0) {
    return 0n
  }
  return 10n ** BigInt(decimals)
}

export const descaleFromQ18 = (value: bigint, decimals: number): bigint => {
  if (decimals === 18) {
    return value
  }
  if (decimals > 18) {
    const multiplier = 10n ** BigInt(decimals - 18)
    return value * multiplier
  }
  const divisor = 10n ** BigInt(18 - decimals)
  return value / divisor
}
