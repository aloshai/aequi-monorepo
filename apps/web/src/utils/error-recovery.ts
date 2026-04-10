export interface ErrorRecoveryAction {
  label: string
  run: () => void
}

export interface ErrorRecoveryHandlers {
  onRefreshQuote: () => void
  onOpenSettings: () => void
  onSetSaferSlippage: () => void
  onSwitchNetwork: () => void
  onConnectWallet: () => void
}

export function resolveErrorRecoveryAction(
  errorMessage: string | null,
  handlers: ErrorRecoveryHandlers,
): ErrorRecoveryAction | null {
  if (!errorMessage) return null

  const msg = errorMessage.toLowerCase()

  if (msg.includes('quote expired') || msg.includes('quote_not_found') || msg.includes('quote not found')) {
    return {
      label: 'Refresh Quote',
      run: handlers.onRefreshQuote,
    }
  }

  if (msg.includes('slippage') || msg.includes('output amount is below') || msg.includes('too little received')) {
    return {
      label: 'Increase Slippage to 1%',
      run: () => {
        handlers.onSetSaferSlippage()
        handlers.onOpenSettings()
      },
    }
  }

  if (msg.includes('switch to the correct network') || msg.includes('network switching')) {
    return {
      label: 'Switch Network',
      run: handlers.onSwitchNetwork,
    }
  }

  if (msg.includes('connect wallet') || msg.includes('injected wallet') || msg.includes('failed to connect')) {
    return {
      label: 'Connect Wallet',
      run: handlers.onConnectWallet,
    }
  }

  if (msg.includes('quote mismatch')) {
    return {
      label: 'Get Fresh Quote',
      run: handlers.onRefreshQuote,
    }
  }

  return null
}
