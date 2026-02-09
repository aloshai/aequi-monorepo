const KNOWN_REVERT_REASONS: Record<string, string> = {
  'INSUFFICIENT_OUTPUT_AMOUNT': 'Swap failed: output amount is below your minimum — try increasing slippage.',
  'EXCESSIVE_INPUT_AMOUNT': 'Swap failed: input amount exceeded maximum.',
  'EXPIRED': 'Swap failed: transaction deadline expired — request a new quote.',
  'TRANSFER_FROM_FAILED': 'Swap failed: token transfer failed — check your balance and approval.',
  'STF': 'Swap failed: token transfer failed (STF) — check approval.',
  'TF': 'Swap failed: token transfer failed (TF).',
  'Too little received': 'Swap failed: slippage too tight — try increasing slippage tolerance.',
  'UniswapV2: K': 'Swap failed: liquidity invariant violated — the pool state changed.',
  'ds-math-sub-underflow': 'Swap failed: arithmetic underflow — likely insufficient liquidity.',
  'execution reverted': 'Transaction reverted on-chain — the swap conditions may have changed.',
}

export function parseSwapError(error: unknown): string {
  const message = extractErrorMessage(error)

  for (const [pattern, friendly] of Object.entries(KNOWN_REVERT_REASONS)) {
    if (message.includes(pattern)) return friendly
  }

  if (message.includes('user rejected') || message.includes('User denied') || message.includes('ACTION_REJECTED')) {
    return 'Transaction rejected by user.'
  }

  if (message.includes('insufficient funds')) {
    return 'Insufficient funds for gas + value.'
  }

  return message || 'Swap failed with an unknown error.'
}

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    if (typeof err.shortMessage === 'string') return err.shortMessage
    if (typeof err.reason === 'string') return err.reason
    if (err.cause && typeof err.cause === 'object') {
      const cause = err.cause as Record<string, unknown>
      if (typeof cause.reason === 'string') return cause.reason
      if (typeof cause.shortMessage === 'string') return cause.shortMessage
    }
    if (typeof err.message === 'string') return err.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}
