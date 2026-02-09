import { formatUnits } from 'viem'
export { defaultAmountForDecimals, descaleFromQ18 } from '@aequi/pricing'

const MAX_UINT256 = (1n << 256n) - 1n

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
  const result = BigInt(units)
  if (result > MAX_UINT256) {
    throw new Error('Amount exceeds maximum uint256 value')
  }
  return result
}

export const formatAmountFromUnits = (value: bigint, decimals: number): string => {
  return formatUnits(value, decimals)
}
