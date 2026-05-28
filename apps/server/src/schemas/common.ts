import { z } from 'zod'
import { isAddress } from 'viem'
import { NATIVE_ADDRESS } from '../config/constants'

export const chainQuerySchema = z.object({
  chain: z.string().min(1),
})

export const addressSchema = z.string().refine(
  (value) => isAddress(value, { strict: false }),
  'Invalid address',
)

export const addressOrNativeSchema = z.string().trim().refine(
  (value) => isAddress(value, { strict: false }) || value.toLowerCase() === NATIVE_ADDRESS.toLowerCase(),
  'Invalid address',
)

export const versionSchema = z.enum(['auto', 'v2', 'v3', 'v4']).optional()

export const boolStringSchema = z.enum(['true', 'false']).optional()
