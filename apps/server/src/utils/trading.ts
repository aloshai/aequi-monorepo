import { getAddress } from 'viem'
import type { Address } from 'viem'
import { NATIVE_ADDRESS } from '../config/constants'

export const clampSlippage = (value: number): number => {
  if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) {
    return 0
  }
  if (value > 5000) {
    return 5000
  }
  return Math.floor(value)
}

export const normalizeAddress = (value: Address | string): Address => {
  if (value.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) {
    return NATIVE_ADDRESS as Address
  }
  return getAddress(value as string)
}
