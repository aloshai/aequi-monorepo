import { useMemo } from 'react'
import type { SwapResponse } from '../types/api'
import { getTokenLogo } from '../utils/logos'

interface SwapConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  swapData: SwapResponse | null
  loading: boolean
  error: string | null
  chain: string
}

export function SwapConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  swapData,
  loading,
  error,
  chain
}: SwapConfirmModalProps) {
  const tokenIn = swapData?.tokens[0]
  const tokenOut = swapData?.tokens[swapData.tokens.length - 1]

  const formatBigIntDisplay = (raw: string | number | bigint, decimals: number, precision = 6): string => {
    const value = BigInt(raw)
    const divisor = 10n ** BigInt(decimals)
    const whole = value / divisor
    const remainder = value - whole * divisor
    const fracStr = remainder.toString().padStart(decimals, '0').slice(0, precision)
    return `${whole}.${fracStr}`
  }

  const amountIn = useMemo(() => {
    if (!swapData || !tokenIn) return '0'
    return formatBigIntDisplay(swapData.amountIn, tokenIn.decimals)
  }, [swapData, tokenIn])

  const amountOut = useMemo(() => {
    if (!swapData || !tokenOut) return '0'
    return formatBigIntDisplay(swapData.amountOut, tokenOut.decimals)
  }, [swapData, tokenOut])

  const minimumReceived = useMemo(() => {
    if (!swapData || !tokenOut) return '0'
    return formatBigIntDisplay(swapData.transaction.amountOutMinimum, tokenOut.decimals)
  }, [swapData, tokenOut])

  const priceImpact = useMemo(() => {
    if (!swapData) return '0'
    return (swapData.priceImpactBps / 100).toFixed(2)
  }, [swapData])

  const routePath = useMemo(() => {
    if (!swapData || !swapData.tokens || swapData.tokens.length <= 2) return []
    // Get intermediate tokens (exclude first and last - those are input/output)
    const intermediateTokens = swapData.tokens.slice(1, -1)
    return intermediateTokens
  }, [swapData])

  const estimatedGas = useMemo(() => {
    if (!swapData?.transaction.estimatedGas) return null
    return swapData.transaction.estimatedGas
  }, [swapData])

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content swap-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close-btn" onClick={onClose}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>

        <div className="modal-body">
          <div className="swap-summary">
            <div className="swap-summary-item">
              <div className="swap-summary-token">
                {tokenIn && (getTokenLogo(tokenIn.symbol)) && (
                  <img src={getTokenLogo(tokenIn.symbol)} alt={tokenIn.symbol} className="token-icon-large" />
                )}
                <div className="swap-summary-details">
                  <span className="swap-summary-label">You Pay</span>
                  <span className="swap-summary-amount">{amountIn} {tokenIn?.symbol}</span>
                </div>
              </div>
            </div>

            <div className="swap-arrow">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
              {routePath.length > 0 && (
                <div className="intermediate-tokens">
                  {routePath.map((token, idx) => (
                    <span key={idx} className="intermediate-token">
                      {token.symbol}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="swap-summary-item">
              <div className="swap-summary-token">
                {tokenOut && (getTokenLogo(tokenOut.symbol)) && (
                  <img src={getTokenLogo(tokenOut.symbol)} alt={tokenOut.symbol} className="token-icon-large" />
                )}
                <div className="swap-summary-details">
                  <span className="swap-summary-label">You Receive</span>
                  <span className="swap-summary-amount">{amountOut} {tokenOut?.symbol}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="swap-details">
            <div className="swap-detail-row">
              <span className="swap-detail-label">Network</span>
              <span className="swap-detail-value">{chain}</span>
            </div>

            <div className="swap-detail-row">
              <span className="swap-detail-label">Route</span>
              <span className="swap-detail-value route-display">
                {swapData?.isSplit && swapData.splits ? (
                  <span className="split-route-summary">
                    Split: {swapData.splits.map((leg, i) => (
                      <span key={i}>
                        {i > 0 && ' + '}
                        {(leg.ratioBps / 100).toFixed(0)}% {leg.quote.source}
                      </span>
                    ))}
                  </span>
                ) : (
                  <>
                    {tokenIn?.symbol}
                    {routePath.length > 0 && routePath.map((token, idx) => (
                      <span key={idx}>
                        <span className="route-arrow"> → </span>
                        {token.symbol}
                      </span>
                    ))}
                  </>
                )}
              </span>
            </div>

            <div className="swap-detail-row">
              <span className="swap-detail-label">Rate</span>
              <span className="swap-detail-value">
                1 {tokenIn?.symbol} = {swapData ? (Number(amountOut) / Number(amountIn)).toFixed(6) : '0'} {tokenOut?.symbol}
              </span>
            </div>

            <div className="swap-detail-row">
              <span className="swap-detail-label">Price Impact</span>
              <span className={`swap-detail-value ${Number(priceImpact) > 5 ? 'warning' : ''}`}>
                {priceImpact}%
              </span>
            </div>

            {Number(priceImpact) > 15 && (
              <div className="error-message" style={{ marginTop: '8px', fontSize: '13px' }}>
                ⚠️ Price impact is extremely high ({priceImpact}%). You may lose a significant portion of your funds.
              </div>
            )}

            <div className="swap-detail-row">
              <span className="swap-detail-label">Minimum Received</span>
              <span className="swap-detail-value">{minimumReceived} {tokenOut?.symbol}</span>
            </div>

            {estimatedGas && (
              <div className="swap-detail-row">
                <span className="swap-detail-label">Estimated Gas</span>
                <span className="swap-detail-value">{estimatedGas}</span>
              </div>
            )}

            {swapData && (
              <div className="swap-detail-row">
                <span className="swap-detail-label">Deadline</span>
                <span className="swap-detail-value">{new Date(swapData.deadline * 1000).toLocaleTimeString()}</span>
              </div>
            )}
          </div>

          {error && (
            <div className="error-message" style={{ marginTop: '16px' }}>
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="modal-btn modal-btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button 
            className="modal-btn modal-btn-primary" 
            onClick={onConfirm}
            disabled={loading || !swapData}
          >
            {loading ? 'Processing...' : 'Execute Swap'}
          </button>
        </div>
      </div>
    </div>
  )
}
