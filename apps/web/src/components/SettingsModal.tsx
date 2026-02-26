import { useState, useEffect } from 'react'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  slippageBps: string
  setSlippageBps: (value: string) => void
  deadlineSeconds: string
  setDeadlineSeconds: (value: string) => void
  version: 'auto' | 'v2' | 'v3'
  setVersion: (value: 'auto' | 'v2' | 'v3') => void
  recommendedSlippageBps?: number
  approvalMode: 'infinite' | 'exact'
  setApprovalMode: (value: 'infinite' | 'exact') => void
}

export function SettingsModal({
  isOpen,
  onClose,
  slippageBps,
  setSlippageBps,
  deadlineSeconds,
  setDeadlineSeconds,
  version,
  setVersion,
  recommendedSlippageBps,
  approvalMode,
  setApprovalMode,
}: SettingsModalProps) {
  const [customSlippage, setCustomSlippage] = useState('')
  const [deadlineMinutes, setDeadlineMinutes] = useState('')

  useEffect(() => {
    if (isOpen) {
      if (slippageBps === 'auto') {
        setCustomSlippage('')
      } else {
        const slippage = Number(slippageBps) / 100
        if ([0.1, 0.5, 1.0].includes(slippage)) {
          setCustomSlippage('')
        } else {
          setCustomSlippage(slippage.toString())
        }
      }
      setDeadlineMinutes((Number(deadlineSeconds) / 60).toString())
    }
  }, [isOpen, slippageBps, deadlineSeconds])

  if (!isOpen) return null

  const handleSlippageSelect = (value: number) => {
    setSlippageBps((value * 100).toString())
    setCustomSlippage('')
  }

  const handleCustomSlippageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setCustomSlippage(val)
    if (val && !isNaN(Number(val))) {
      const clamped = Math.min(Math.max(Number(val), 0), 50)
      setSlippageBps((clamped * 100).toString())
    }
  }

  const handleDeadlineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setDeadlineMinutes(val)
    if (val && !isNaN(Number(val))) {
      const clamped = Math.min(Math.max(Number(val), 1), 60)
      setDeadlineSeconds((clamped * 60).toString())
    }
  }

  const isAuto = slippageBps === 'auto'
  const currentSlippage = isAuto ? 0 : Number(slippageBps) / 100
  const autoLabel = recommendedSlippageBps != null ? `Auto (${(recommendedSlippageBps / 100).toFixed(1)}%)` : 'Auto'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Settings</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="settings-section">
          <label className="settings-label">Slippage Tolerance</label>
          <div className="slippage-options">
            <button
              className={`slippage-btn ${isAuto ? 'active' : ''}`}
              onClick={() => { setSlippageBps('auto'); setCustomSlippage('') }}
            >
              {autoLabel}
            </button>
            {[0.1, 0.5, 1.0].map((val) => (
              <button
                key={val}
                className={`slippage-btn ${!isAuto && currentSlippage === val && !customSlippage ? 'active' : ''}`}
                onClick={() => handleSlippageSelect(val)}
              >
                {val}%
              </button>
            ))}
            <div className={`custom-slippage-input ${customSlippage ? 'active' : ''}`}>
              <input
                type="number"
                placeholder="Custom"
                value={customSlippage}
                onChange={handleCustomSlippageChange}
                step="0.1"
                min="0"
                max="50"
              />
              <span>%</span>
            </div>
          </div>
        </div>

        <div className="settings-section">
          <label className="settings-label">Transaction Deadline</label>
          <div className="deadline-input-container">
            <input
              type="number"
              value={deadlineMinutes}
              onChange={handleDeadlineChange}
              min="1"
            />
            <span>minutes</span>
          </div>
        </div>

        <div className="settings-section">
          <label className="settings-label">Routing Preference</label>
          <div className="routing-options">
            {(['auto', 'v2', 'v3'] as const).map((v) => (
              <button
                key={v}
                className={`routing-btn ${version === v ? 'active' : ''}`}
                onClick={() => setVersion(v)}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <label className="settings-label">Token Approval</label>
          <div className="routing-options">
            <button
              className={`routing-btn ${approvalMode === 'exact' ? 'active' : ''}`}
              onClick={() => setApprovalMode('exact')}
            >
              Exact Amount
            </button>
            <button
              className={`routing-btn ${approvalMode === 'infinite' ? 'active' : ''}`}
              onClick={() => setApprovalMode('infinite')}
            >
              Unlimited
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
