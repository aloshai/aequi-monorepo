import { z } from 'zod'
import { chainQuerySchema, addressOrNativeSchema, versionSchema, boolStringSchema } from './common'

export const quoteQuerySchema = chainQuerySchema.extend({
  tokenA: addressOrNativeSchema,
  tokenB: addressOrNativeSchema,
  amount: z.string().min(1, 'Amount is required'),
  slippageBps: z.string().optional(),
  version: versionSchema,
  forceMultiHop: boolStringSchema,
  enableSplit: boolStringSchema,
})
