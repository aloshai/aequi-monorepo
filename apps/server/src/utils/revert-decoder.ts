import { decodeErrorResult, type Hex } from 'viem'

const EXECUTOR_ERRORS = [
  {
    type: 'error' as const,
    name: 'ExecutionFailed',
    inputs: [
      { name: 'index', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'reason', type: 'bytes' },
    ],
  },
  {
    type: 'error' as const,
    name: 'InvalidInjectionOffset',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'length', type: 'uint256' },
    ],
  },
  {
    type: 'error' as const,
    name: 'ZeroAmountInjection',
    inputs: [],
  },
] as const

const ERC20_ERRORS = [
  {
    type: 'error' as const,
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'balance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  {
    type: 'error' as const,
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'allowance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
] as const

const KNOWN_ABIS = [...EXECUTOR_ERRORS, ...ERC20_ERRORS]

export interface DecodedRevert {
  code: string
  message: string
  details?: Record<string, unknown>
}

export const decodeRevertReason = (data: Hex | undefined): DecodedRevert => {
  if (!data || data === '0x') {
    return { code: 'unknown_revert', message: 'Transaction reverted without reason' }
  }

  try {
    const decoded = decodeErrorResult({ abi: KNOWN_ABIS, data })

    switch (decoded.errorName) {
      case 'ExecutionFailed': {
        const [index, target, reason] = decoded.args as [bigint, string, Hex]
        const inner = reason && reason !== '0x' ? decodeRevertReason(reason) : null
        return {
          code: 'execution_failed',
          message: inner
            ? `Swap call #${index} to ${target} failed: ${inner.message}`
            : `Swap call #${index} to ${target} failed`,
          details: { index: Number(index), target, innerReason: inner },
        }
      }
      case 'ZeroAmountInjection':
        return { code: 'zero_amount_injection', message: 'Zero token balance at injection point — likely insufficient intermediate tokens' }
      case 'InvalidInjectionOffset':
        return { code: 'invalid_injection_offset', message: 'Internal calldata encoding error' }
      case 'ERC20InsufficientBalance': {
        const [sender, balance, needed] = decoded.args as [string, bigint, bigint]
        return {
          code: 'insufficient_balance',
          message: `Insufficient token balance: have ${balance}, need ${needed}`,
          details: { sender, balance: balance.toString(), needed: needed.toString() },
        }
      }
      case 'ERC20InsufficientAllowance': {
        const [spender, allowance, needed] = decoded.args as [string, bigint, bigint]
        return {
          code: 'insufficient_allowance',
          message: `Insufficient token allowance: approved ${allowance}, need ${needed}`,
          details: { spender, allowance: allowance.toString(), needed: needed.toString() },
        }
      }
    }
  } catch {
    // fall through to string check
  }

  // Try to decode as a revert string: Error(string)
  if (data.startsWith('0x08c379a0')) {
    try {
      const reason = decodeErrorResult({
        abi: [{ type: 'error', name: 'Error', inputs: [{ name: 'reason', type: 'string' }] }],
        data,
      })
      const message = (reason.args as [string])[0]
      return { code: 'revert_string', message }
    } catch {}
  }

  // Panic(uint256)
  if (data.startsWith('0x4e487b71')) {
    return { code: 'panic', message: 'EVM Panic — arithmetic overflow or assertion failure' }
  }

  return { code: 'unknown_revert', message: `Transaction reverted with data: ${data.slice(0, 42)}...` }
}
