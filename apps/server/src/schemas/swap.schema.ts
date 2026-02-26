import { z } from 'zod'
import { isAddress } from 'viem'
import { addressOrNativeSchema, versionSchema } from './common'

export const swapBodySchema = z.object({
  chain: z.string().min(1),
  tokenA: addressOrNativeSchema,
  tokenB: addressOrNativeSchema,
  amount: z.string().min(1, 'Amount is required'),
  slippageBps: z.coerce.number().min(0).max(10000).optional(),
  version: versionSchema,
  recipient: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid recipient address'),
  deadlineSeconds: z.coerce.number().min(10).max(3600).optional(),
  forceMultiHop: z.boolean().optional(),
  enableSplit: z.boolean().optional(),
  quoteId: z.string().uuid().optional(),
})
