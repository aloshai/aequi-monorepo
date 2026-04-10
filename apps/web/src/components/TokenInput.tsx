import type { Token } from '../services/token-manager'
import { getTokenLogo } from '../utils/logos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

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
    <section className="rounded-xl border border-border bg-background p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        {balance && <Badge variant="outline" className="font-mono text-[11px]">Balance: {balance}</Badge>}
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" className="h-11 gap-2 rounded-full px-3" onClick={onTokenSelect}>
          {token ? (
            <>
              {logo && <img src={logo} alt={token.symbol} className="h-6 w-6 rounded-full object-cover" />}
              <span>{token.symbol}</span>
            </>
          ) : (
            <span>Select</span>
          )}
          <svg className="h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </Button>

        <Input
          className="h-12 border-0 bg-transparent px-0 text-right text-3xl font-semibold tracking-tight focus-visible:ring-0"
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
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onQuarter} disabled={shortcutsDisabled}>25%</Button>
          <Button type="button" variant="outline" size="sm" onClick={onHalf} disabled={shortcutsDisabled}>50%</Button>
          <Button type="button" variant="outline" size="sm" onClick={onMax} disabled={shortcutsDisabled}>Max</Button>
        </div>
      )}
    </section>
  )
}
