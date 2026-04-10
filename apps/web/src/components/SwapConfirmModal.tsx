import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import type { SwapResponse } from '../types/api'
import { getTokenLogo } from '../utils/logos'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface SwapConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  swapData: SwapResponse | null
  loading: boolean
  error: string | null
  chain: string
}

const formatBigIntDisplay = (raw: string | number | bigint, decimals: number, precision = 6): string => {
  const value = BigInt(raw)
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const remainder = value - whole * divisor
  const fracStr = remainder.toString().padStart(decimals, '0').slice(0, precision)
  return `${whole}.${fracStr}`
}

export function SwapConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  swapData,
  loading,
  error,
  chain,
}: SwapConfirmModalProps) {
  const tokenIn = swapData?.tokens[0]
  const tokenOut = swapData?.tokens[swapData.tokens.length - 1]
  const [impactAccepted, setImpactAccepted] = useState(false)

  useEffect(() => {
    if (!isOpen) setImpactAccepted(false)
  }, [isOpen])

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

  const routePath = useMemo(() => {
    if (!swapData || swapData.tokens.length <= 2) return []
    return swapData.tokens.slice(1, -1)
  }, [swapData])

  const priceImpact = useMemo(() => {
    if (!swapData) return 0
    return swapData.priceImpactBps / 100
  }, [swapData])

  const estimatedGas = swapData?.transaction.estimatedGas ?? null
  const simulationPassed = swapData?.simulationPassed ?? false
  const isExtremeImpact = priceImpact > 15
  const isHighImpact = priceImpact > 5 && priceImpact <= 15

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden border-border bg-card p-0">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          className="flex max-h-[90vh] flex-col"
        >
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Confirm Swap</DialogTitle>
            <DialogDescription>
              Review route, impact, and transaction details before execution.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <Card className="border-border bg-background">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {tokenIn && getTokenLogo(tokenIn.symbol) && (
                      <img src={getTokenLogo(tokenIn.symbol)} alt={tokenIn.symbol} className="h-10 w-10 rounded-full object-cover" />
                    )}
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">You Pay</p>
                      <p className="text-lg font-semibold">{amountIn} {tokenIn?.symbol}</p>
                    </div>
                  </div>
                  <Badge variant="outline">{chain}</Badge>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{tokenIn?.symbol}</span>
                  {routePath.length > 0 && routePath.map((token) => (
                    <span key={token.address} className="inline-flex items-center gap-2">
                      <span>{'->'}</span>
                      <span>{token.symbol}</span>
                    </span>
                  ))}
                  <span>{'->'}</span>
                  <span>{tokenOut?.symbol}</span>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <div className="flex items-center gap-3">
                    {tokenOut && getTokenLogo(tokenOut.symbol) && (
                      <img src={getTokenLogo(tokenOut.symbol)} alt={tokenOut.symbol} className="h-10 w-10 rounded-full object-cover" />
                    )}
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">You Receive</p>
                      <p className="text-lg font-semibold">{amountOut} {tokenOut?.symbol}</p>
                    </div>
                  </div>
                  <Badge variant={simulationPassed ? 'success' : 'warning'}>
                    {simulationPassed ? 'Simulation Passed' : 'Simulation Unverified'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border bg-muted/30">
              <CardContent className="space-y-2 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Rate</span>
                  <span className="font-medium">
                    1 {tokenIn?.symbol} = {swapData ? (Number(amountOut) / Number(amountIn)).toFixed(6) : '0'} {tokenOut?.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Price Impact</span>
                  <span className={priceImpact > 5 ? 'font-semibold text-amber-600' : 'font-medium'}>{priceImpact.toFixed(2)}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Minimum Received</span>
                  <span className="font-medium">{minimumReceived} {tokenOut?.symbol}</span>
                </div>
                {estimatedGas && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Estimated Gas</span>
                    <span className="font-medium">{estimatedGas}</span>
                  </div>
                )}
                {swapData && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Deadline</span>
                    <span className="font-medium">{new Date(swapData.deadline * 1000).toLocaleTimeString()}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {isExtremeImpact && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
                <div className="mb-2 flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>Price impact is extremely high ({priceImpact.toFixed(2)}%). You may lose a significant portion of funds.</span>
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={impactAccepted}
                    onChange={(e) => setImpactAccepted(e.target.checked)}
                  />
                  I understand the risk and want to proceed.
                </label>
              </div>
            )}

            {isHighImpact && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                Price impact is high ({priceImpact.toFixed(2)}%). Double-check route details before execution.
              </div>
            )}

            {!simulationPassed && swapData && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                On-chain simulation could not verify this transaction. Execution may fail if pool state changes.
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              disabled={loading || !swapData || (isExtremeImpact && !impactAccepted)}
              className="min-w-36"
            >
              {loading ? 'Processing...' : isExtremeImpact && !impactAccepted ? 'Accept Risk to Swap' : 'Execute Swap'}
            </Button>
          </DialogFooter>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
