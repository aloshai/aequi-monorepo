import { z } from 'zod'
import { chainQuerySchema, addressOrNativeSchema, versionSchema, boolStringSchema } from './common'

export const priceQuerySchema = chainQuerySchema.extend({
  tokenA: addressOrNativeSchema,
  tokenB: addressOrNativeSchema,
  amount: z.string().optional(),
  version: versionSchema,
  forceMultiHop: boolStringSchema,
  enableSplit: boolStringSchema,
})
