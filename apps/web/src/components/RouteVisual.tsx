import { motion } from 'framer-motion'
import type { QuoteResponse, RouteToken } from '../types/api'
import { getTokenLogo } from '../utils/logos'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface RouteVisualProps {
  quote: QuoteResponse
  tokenB: RouteToken
}

function RouteTokenNode({ symbol }: { symbol: string }) {
  const logo = getTokenLogo(symbol)
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-xs font-medium">
      {logo && (
        <img
          src={logo}
          alt={symbol}
          className="h-4 w-4 rounded-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      )}
      {symbol}
    </span>
  )
}

function PoolConnector({ dexId, feeTier, version }: { dexId: string; feeTier?: number | null; version?: string }) {
  const dexName = dexId.split('-')[0]
  const fee = feeTier ? `${feeTier / 10000}%` : ''
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>{'->'}</span>
      <span>{dexName}{version ? ` ${version}` : ''}{fee ? ` ${fee}` : ''}</span>
    </span>
  )
}

function SingleRoute({ quote }: { quote: QuoteResponse }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {quote.tokens.map((token, idx) => {
        const isLast = idx === quote.tokens.length - 1
        const pool = !isLast ? quote.pools[idx] : null
        return (
          <span key={token.address} className="inline-flex items-center gap-2">
            <RouteTokenNode symbol={token.symbol} />
            {!isLast && pool && (
              <PoolConnector dexId={pool.dexId} feeTier={pool.feeTier} version={quote.hopVersions[idx]} />
            )}
          </span>
        )
      })}
    </div>
  )
}

export function RouteVisual({ quote, tokenB }: RouteVisualProps) {
  const hopCount = quote.tokens.length - 1
  const sourceCount = quote.sources.length
  const dexCount = new Set(quote.pools.map((pool) => pool.dexId.split('-')[0])).size
  const routeComplexity = hopCount <= 1 ? 'Simple' : hopCount <= 2 ? 'Balanced' : 'Complex'

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      className="w-full max-w-[560px]"
    >
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">Route Breakdown</CardTitle>
            {quote.isSplit && <Badge variant="secondary">Split Route</Badge>}
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Complexity</p>
              <p className="text-sm font-semibold text-foreground">{routeComplexity}</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Topology</p>
              <p className="text-sm font-semibold text-foreground">{hopCount} hop · {dexCount} DEX</p>
            </div>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Sources</p>
              <p className="text-sm font-semibold text-foreground">{sourceCount} pools</p>
            </div>
          </div>

          {quote.isSplit && quote.splits ? (
            <div className="space-y-3">
              {quote.splits.map((leg, i) => (
                <div key={i} className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                    <Badge variant="outline">{(leg.ratioBps / 100).toFixed(0)}%</Badge>
                    <span className="text-muted-foreground">{leg.quote.source}</span>
                    <span className="font-medium text-foreground">
                      {(Number(leg.quote.amountOut) / 10 ** tokenB.decimals).toFixed(4)} {tokenB.symbol}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {leg.quote.tokens.map((token, idx) => {
                      const isLast = idx === leg.quote.tokens.length - 1
                      const pool = !isLast ? leg.quote.pools[idx] : null
                      return (
                        <span key={token.address} className="inline-flex items-center gap-2">
                          <RouteTokenNode symbol={token.symbol} />
                          {!isLast && pool && (
                            <PoolConnector dexId={pool.dexId} feeTier={pool.feeTier} version={leg.quote.hopVersions[idx]} />
                          )}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <SingleRoute quote={quote} />
          )}
        </CardContent>
      </Card>
    </motion.section>
  )
}
