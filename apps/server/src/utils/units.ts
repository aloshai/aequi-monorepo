import { formatUnits } from 'viem'
export { defaultAmountForDecimals, descaleFromQ18 } from '@aequi/pricing'

export const parseAmountToUnits = (value: string, decimals: number): bigint => {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Amount is required')
  }

  if (!/^(\d+)(\.\d+)?$|^\.\d+$/.test(trimmed)) {
    throw new Error('Amount must be a positive number')
  }

  const [whole, fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) {
    throw new Error(`Amount supports up to ${decimals} decimal places`)
  }

  const normalizedFraction = fraction.padEnd(decimals, '0')
  const normalized = `${whole}${normalizedFraction}`.replace(/^0+/, '')
  const units = normalized.length ? normalized : '0'

  return BigInt(units)
}

export const formatAmountFromUnits = (value: bigint, decimals: number): string => {
  return formatUnits(value, decimals)
}
