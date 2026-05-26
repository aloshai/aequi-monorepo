import { z } from 'zod'
import { isAddress } from 'viem'
import { addressOrNativeSchema, versionSchema } from './common'

/**
 * Execution path selector:
 *   - `aequi-executor` (default): legacy AequiExecutor multicall. Stable.
 *   - `settler-allowance-holder`: route through 0x Settler in AllowanceHolder mode.
 *     Returns calldata for `AllowanceHolder.exec(...)` wrapping `Settler.execute(...)`.
 *     Frontend approves AllowanceHolder once, then sends the swap tx directly.
 *   - `settler-permit2`: route through 0x SettlerMetaTxn with Permit2 signatures.
 *     Response includes an EIP-712 payload the user signs in the wallet; the
 *     signature is injected into calldata client-side. (TODO_PERMIT2 — pending)
 */
export const tokenFlowSchema = z
  .enum(['aequi-executor', 'settler-allowance-holder', 'settler-permit2'])
  .default('aequi-executor')

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
