import { z } from 'zod'
import { isAddress } from 'viem'
import { chainQuerySchema, addressSchema } from './common'

export const tokenQuerySchema = chainQuerySchema.extend({
  address: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid address'),
})

export const allowanceQuerySchema = chainQuerySchema.extend({
  owner: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid owner address'),
  spender: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid spender address'),
  tokens: z.string().min(1, 'tokens query parameter is required'),
})

export const approveBodySchema = z.object({
  chain: z.string().min(1),
  token: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid token address'),
  spender: z.string().refine((value) => isAddress(value, { strict: false }), 'Invalid spender address'),
  amount: z.string().optional(),
  infinite: z.boolean().optional(),
})
