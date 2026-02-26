import type { Token } from '../services/token-manager'
import { getTokenLogo } from '../utils/logos'

interface TokenInputProps {
  label: string
  token: Token | null
  amount: string
  onAmountChange?: (value: string) => void
  onTokenSelect: () => void
  balance?: string
  readOnly?: boolean
  showShortcuts?: boolean
  onQuarter?: () => void
  onHalf?: () => void
  onMax?: () => void
  shortcutsDisabled?: boolean
}

export function TokenInput({
  label,
  token,
  amount,
  onAmountChange,
  onTokenSelect,
  balance,
  readOnly,
  showShortcuts,
  onQuarter,
  onHalf,
  onMax,
  shortcutsDisabled,
}: TokenInputProps) {
  const logo = token ? (token.logoURI || getTokenLogo(token.symbol)) : ''

  return (
    <div className="token-input">
      <div className="token-input__header">
        <span className="token-input__label">{label}</span>
        {balance && (
          <span className="token-input__balance">Balance: {balance}</span>
        )}
      </div>
      <div className="token-input__row">
        <button className="token-selector" onClick={onTokenSelect}>
          {token ? (
            <>
              {logo && <img src={logo} alt={token.symbol} className="token-selector__icon" />}
              {token.symbol}
            </>
          ) : (
            <span>Select</span>
          )}
          <svg className="token-selector__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <input
          className="token-amount-input"
          placeholder="0"
          inputMode="decimal"
          value={amount}
          onChange={onAmountChange ? (e) => {
            const v = e.target.value
            if (v === '' || /^\d*\.?\d*$/.test(v)) onAmountChange(v)
          } : undefined}
          readOnly={readOnly}
        />
      </div>
      {showShortcuts && (
        <div className="token-input__shortcuts">
          <button className="shortcut-btn" onClick={onQuarter} disabled={shortcutsDisabled}>25%</button>
          <button className="shortcut-btn" onClick={onHalf} disabled={shortcutsDisabled}>50%</button>
          <button className="shortcut-btn" onClick={onMax} disabled={shortcutsDisabled}>Max</button>
        </div>
      )}
    </div>
  )
}
