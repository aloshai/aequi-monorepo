import { motion } from 'framer-motion'
import type { QuoteResponse, RouteToken } from '../types/api'
import { useSwapStore } from '../store/use-swap-store'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface QuoteDetailsProps {
  quote: QuoteResponse
  tokenA: RouteToken
  tokenB: RouteToken
}

const NATIVE_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',
  bsc: 'BNB',
}

function StatRow({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${valueClassName ?? ''}`}>{value}</span>
    </div>
  )
}

export function QuoteDetails({ quote, tokenA, tokenB }: QuoteDetailsProps) {
  const quoteCountdown = useSwapStore((s) => s.quoteCountdown)
  const nativeCurrency = NATIVE_SYMBOL[quote.chain] ?? 'ETH'

  const rate = Number(quote.amountOut) / 10 ** tokenB.decimals / Number(quote.amountInFormatted)
  const priceImpact = quote.priceImpactBps / 100
  const gasCost = quote.estimatedGasCostWei
    ? (Number(quote.estimatedGasCostWei) / 1e18).toFixed(6)
    : null
  const gasGwei = quote.gasPriceWei
    ? (Number(quote.gasPriceWei) / 1e9).toFixed(1)
    : null

  const midPrice = BigInt(quote.midPriceQ18)
  const execPrice = BigInt(quote.executionPriceQ18)
  const spread = midPrice > 0n
    ? Number((midPrice - execPrice) * 10000n / midPrice) / 100
    : 0

  const impactClass =
    priceImpact > 5 ? 'text-red-600' :
    priceImpact > 1 ? 'text-amber-600' :
    ''

  const hopCount = quote.tokens.length - 1
  const sourceCount = quote.sources.length
  const dexCount = new Set(quote.pools.map((p) => p.dexId.split('-')[0])).size

  const impactPenalty = Math.min(32, priceImpact * 3.2)
  const hopPenalty = Math.max(0, hopCount - 1) * 5
  const splitPenalty = quote.isSplit ? 3 : 0
  const dexBonus = Math.min(10, dexCount * 2)
  const sourceBonus = sourceCount >= 4 ? 5 : sourceCount >= 2 ? 2 : 0
  const rawScore = Math.round(82 - impactPenalty - hopPenalty - splitPenalty + dexBonus + sourceBonus)
  const confidenceScore = Math.max(35, Math.min(99, rawScore))

  const confidenceTone =
    confidenceScore >= 78 ? 'text-emerald-700' :
    confidenceScore >= 58 ? 'text-amber-700' :
    'text-rose-700'
  const confidenceLabel =
    confidenceScore >= 78 ? 'High' :
    confidenceScore >= 58 ? 'Medium' :
    'Low'

  const freshnessAgeSeconds = quoteCountdown > 0 ? Math.max(0, 30 - quoteCountdown) : 30
  const executionSlippage = Math.max(0, priceImpact - spread)
  const routingFriction = Math.max(0, spread)

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="w-full max-w-[560px]"
    >
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Quote Insights</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{quote.routePreference.toUpperCase()}</Badge>
              {quoteCountdown > 0 && (
                <Badge variant={quoteCountdown <= 5 ? 'warning' : 'outline'}>
                  Refresh in {quoteCountdown}s
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Confidence</p>
              <p className={`text-sm font-semibold ${confidenceTone}`}>{confidenceScore}/100 · {confidenceLabel}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Sources</p>
              <p className="text-sm font-semibold text-foreground">{sourceCount} pools · {dexCount} DEX</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Freshness</p>
              <p className="text-sm font-semibold text-foreground">Updated {freshnessAgeSeconds}s ago</p>
            </div>
          </div>

          <StatRow label="Rate" value={`1 ${tokenA.symbol} = ${rate.toFixed(6)} ${tokenB.symbol}`} />
          <StatRow label="Price Impact" value={`${priceImpact.toFixed(2)}%`} valueClassName={impactClass} />
          <StatRow label="Execution Slippage" value={`${executionSlippage.toFixed(2)}%`} />
          <StatRow label="Routing Friction" value={`${routingFriction.toFixed(2)}%`} />
          <StatRow label="Spread" value={`${spread.toFixed(2)}%`} />
          {gasCost && (
            <StatRow label="Gas" value={`${gasCost} ${nativeCurrency}${gasGwei ? ` (${gasGwei} gwei)` : ''}`} />
          )}
          <StatRow
            label="Route"
            value={quote.isSplit ? `Split (${quote.splits?.length ?? 0} legs)` : `${quote.tokens.length - 1} hop${quote.tokens.length > 2 ? 's' : ''}`}
          />
          <StatRow label="Minimum Received" value={`${quote.amountOutMinFormatted} ${tokenB.symbol}`} />
        </CardContent>
      </Card>
    </motion.section>
  )
}
