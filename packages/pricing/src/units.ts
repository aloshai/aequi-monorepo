export const defaultAmountForDecimals = (decimals: number): bigint => {
  if (decimals < 0) {
    return 0n
  }
  const base = decimals > 6 ? 6 : decimals
  return 10n ** BigInt(base)
}
