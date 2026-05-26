import { z } from 'zod'
import { isAddress } from 'viem'
import { addressOrNativeSchema, versionSchema } from './common'

/**
 * Execution path selector — Aequi routes all swaps through 0x Settler.
 *
 *   - `settler-allowance-holder` (default): legacy-friendly approve flow.
 *     Returns calldata for `AllowanceHolder.exec(...)` wrapping
 *     `Settler.execute(...)`. Frontend approves AllowanceHolder once per
 *     token, then sends the swap tx directly.
 *
 *   - `settler-permit2`: gasless-approval flow. Returns the EIP-712 typed
 *     data the user signs in the wallet, plus the actions[] + slippage
 *     tuple needed to re-encode `executeMetaTxn(...)` client-side.
 */
export const tokenFlowSchema = z
  .enum(['settler-allowance-holder', 'settler-permit2'])
  .default('settler-allowance-holder')

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
  tokenFlow: tokenFlowSchema.optional(),
})
