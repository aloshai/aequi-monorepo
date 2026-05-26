import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type TokenFlow = 'settler-allowance-holder' | 'settler-permit2'

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
  tokenFlow?: TokenFlow
  setTokenFlow?: (value: TokenFlow) => void
}

const ROUTE_OPTIONS = ['auto', 'v2', 'v3'] as const
const QUICK_SLIPPAGE = [0.1, 0.5, 1.0]

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
  tokenFlow,
  setTokenFlow,
}: SettingsModalProps) {
  const [customSlippage, setCustomSlippage] = useState('')
  const [deadlineMinutes, setDeadlineMinutes] = useState('')

  useEffect(() => {
    if (!isOpen) return

    if (slippageBps === 'auto') {
      setCustomSlippage('')
    } else {
      const slippage = Number(slippageBps) / 100
      setCustomSlippage(QUICK_SLIPPAGE.includes(slippage) ? '' : slippage.toString())
    }

    setDeadlineMinutes((Number(deadlineSeconds) / 60).toString())
  }, [isOpen, slippageBps, deadlineSeconds])

  const handleSlippageSelect = (value: number) => {
    setSlippageBps((value * 100).toString())
    setCustomSlippage('')
  }

  const handleCustomSlippageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setCustomSlippage(val)
    if (!val || Number.isNaN(Number(val))) return

    const clamped = Math.min(Math.max(Number(val), 0), 50)
    setSlippageBps((clamped * 100).toString())
  }

  const handleDeadlineChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setDeadlineMinutes(val)
    if (!val || Number.isNaN(Number(val))) return

    const clamped = Math.min(Math.max(Number(val), 1), 60)
    setDeadlineSeconds((clamped * 60).toString())
  }

  const isAuto = slippageBps === 'auto'
  const currentSlippage = isAuto ? 0 : Number(slippageBps) / 100
  const autoLabel = recommendedSlippageBps != null ? `Auto (${(recommendedSlippageBps / 100).toFixed(1)}%)` : 'Auto'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md border-border bg-card p-0">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Tune execution behavior for slippage, routing, and token approvals.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-5 py-5">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Slippage Tolerance</p>
                <Badge variant={isAuto ? 'secondary' : 'outline'}>{isAuto ? 'Auto' : 'Manual'}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={isAuto ? 'default' : 'outline'}
                  onClick={() => {
                    setSlippageBps('auto')
                    setCustomSlippage('')
                  }}
                >
                  {autoLabel}
                </Button>
                {QUICK_SLIPPAGE.map((val) => (
                  <Button
                    key={val}
                    type="button"
                    variant={!isAuto && currentSlippage === val && !customSlippage ? 'default' : 'outline'}
                    onClick={() => handleSlippageSelect(val)}
                  >
                    {val}%
                  </Button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Custom"
                  value={customSlippage}
                  onChange={handleCustomSlippageChange}
                  step="0.1"
                  min="0"
                  max="50"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Transaction Deadline</p>
              <div className="flex items-center gap-2">
                <Input type="number" value={deadlineMinutes} onChange={handleDeadlineChange} min="1" max="60" />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Routing Preference</p>
              <div className="grid grid-cols-3 gap-2">
                {ROUTE_OPTIONS.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={version === value ? 'default' : 'outline'}
                    onClick={() => setVersion(value)}
                  >
                    {value.toUpperCase()}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Token Approval</p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={approvalMode === 'exact' ? 'default' : 'outline'}
                  onClick={() => setApprovalMode('exact')}
                >
                  Exact Amount
                </Button>
                <Button
                  type="button"
                  variant={approvalMode === 'infinite' ? 'default' : 'outline'}
                  onClick={() => setApprovalMode('infinite')}
                >
                  Unlimited
                </Button>
              </div>
            </section>

            {tokenFlow != null && setTokenFlow != null && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Token Flow
                  </p>
                  <Badge variant="outline">0x Settler</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  AllowanceHolder: one-time ERC20 approve, then each swap is a single tx (recommended).
                  Permit2: one-time approve(Permit2), then each swap requires an EIP-712 signature in the wallet — gas-efficient and revocable per swap.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    type="button"
                    variant={tokenFlow === 'settler-allowance-holder' ? 'default' : 'outline'}
                    onClick={() => setTokenFlow('settler-allowance-holder')}
                  >
                    AllowanceHolder (recommended)
                  </Button>
                  <Button
                    type="button"
                    variant={tokenFlow === 'settler-permit2' ? 'default' : 'outline'}
                    onClick={() => setTokenFlow('settler-permit2')}
                  >
                    Permit2 (sign per swap)
                  </Button>
                </div>
              </section>
            )}
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
