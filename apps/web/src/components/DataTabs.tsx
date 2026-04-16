import { useState } from 'react'
import { motion } from 'framer-motion'
import type { QuoteResponse, RouteToken, ChainKey } from '../types/api'
import { useSwapStore } from '../store/use-swap-store'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const BLOCK_EXPLORER: Record<ChainKey, string> = {
  ethereum: 'https://etherscan.io',
  bsc: 'https://bscscan.com',
  incentiv: 'https://explorer.incentiv.io',
}

interface DataTabsProps {
  quote: QuoteResponse
  tokenB: RouteToken
}

function OffersTab({ quote, tokenB }: { quote: QuoteResponse; tokenB: RouteToken }) {
  if (!quote.offers || quote.offers.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No alternative routes yet.</p>
  }

  const bestAmount = Number(quote.offers[0]!.amountOut) / 10 ** tokenB.decimals
  const lowestImpact = Math.min(...quote.offers.map((offer) => offer.priceImpactBps))
  const lowestGas = Math.min(...quote.offers.map((offer) => Number(offer.estimatedGasCostWei ?? Number.MAX_SAFE_INTEGER)))

  return (
    <div className="overflow-x-auto">
      <table className="offers-table">
        <thead>
          <tr>
            <th>Route</th>
            <th>Output</th>
            <th>Impact</th>
            <th>Gas</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {quote.offers.map((offer, idx) => {
            const isBest = idx === 0
            const offerAmount = Number(offer.amountOut) / 10 ** tokenB.decimals
            const offerImpact = offer.priceImpactBps / 100
            const offerGas = offer.estimatedGasCostWei
              ? (Number(offer.estimatedGasCostWei) / 1e18).toFixed(5)
              : '-'
            const gasNumber = Number(offer.estimatedGasCostWei ?? Number.MAX_SAFE_INTEGER)
            const isLowestImpact = offer.priceImpactBps === lowestImpact
            const isLowestGas = gasNumber === lowestGas

            let reason = ''
            if (!isBest) {
              const diff = ((bestAmount - offerAmount) / bestAmount * 100)
              if (diff > 0.5) reason = `${diff.toFixed(1)}% less`
              else if (offerImpact > quote.priceImpactBps / 100) reason = 'Higher impact'
              else reason = 'Higher gas'
            }

            const impactClass = offerImpact > 5 ? 'text-red-600' : offerImpact > 1 ? 'text-amber-600' : 'text-foreground'

            return (
              <tr key={idx} className={isBest ? 'best-row' : undefined}>
                <td>
                  {offer.pools.map((p, i) => (
                    <Badge key={`${p.poolAddress}-${i}`} variant="secondary" className="mr-1 capitalize">
                      {p.dexId.split('-')[0]}
                    </Badge>
                  ))}
                </td>
                <td>{offerAmount.toFixed(4)}</td>
                <td className={impactClass}>{offerImpact.toFixed(2)}%</td>
                <td className="text-muted-foreground">{offerGas}</td>
                <td>
                  <div className="flex flex-wrap justify-end gap-1">
                    {isBest && <Badge variant="success">Best Output</Badge>}
                    {isLowestImpact && <Badge variant="warning">Lowest Impact</Badge>}
                    {isLowestGas && <Badge variant="outline">Lowest Gas</Badge>}
                    {!isBest && !isLowestImpact && !isLowestGas && (
                      <span className="reason-text">{reason}</span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PoolsTab({ quote }: { quote: QuoteResponse }) {
  return (
    <div className="pools-grid">
      {quote.sources.map((source, idx) => {
        const tokenIn = quote.tokens[idx]
        const tokenOut = quote.tokens[idx + 1]
        if (!tokenIn || !tokenOut) return null

        return (
          <Card key={`${source.poolAddress ?? source.dexId}-${idx}`} className="bg-background">
            <CardContent className="p-3">
              <div className="pool-card__header">
                <span className="pool-card__dex">{source.dexId.split('-')[0]}</span>
                <span className="pool-card__pair">{tokenIn.symbol}/{tokenOut.symbol}</span>
              </div>

              {source.reserves ? (
                <>
                  {source.reserves.liquidity ? (
                    <div className="pool-card__row">
                      <span className="pool-card__label">Liquidity (L)</span>
                      <span className="pool-card__value">{Number(source.reserves.liquidity).toExponential(2)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="pool-card__row">
                        <span className="pool-card__label">
                          {source.reserves.token0?.toLowerCase() === tokenIn.address.toLowerCase() ? tokenIn.symbol : tokenOut.symbol}
                        </span>
                        <span className="pool-card__value">
                          {(Number(source.reserves.reserve0) / 10 ** (source.reserves.token0?.toLowerCase() === tokenIn.address.toLowerCase() ? tokenIn.decimals : tokenOut.decimals)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                      <div className="pool-card__row">
                        <span className="pool-card__label">
                          {source.reserves.token1?.toLowerCase() === tokenIn.address.toLowerCase() ? tokenIn.symbol : tokenOut.symbol}
                        </span>
                        <span className="pool-card__value">
                          {(Number(source.reserves.reserve1) / 10 ** (source.reserves.token1?.toLowerCase() === tokenIn.address.toLowerCase() ? tokenIn.decimals : tokenOut.decimals)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    </>
                  )}
                  {source.feeTier != null && (
                    <div className="pool-card__row">
                      <span className="pool-card__label">Fee</span>
                      <span className="pool-card__value">{source.feeTier / 10000}%</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="pool-card__row">
                  <span className="pool-card__label italic">Data unavailable</span>
                  <span className="pool-card__value" />
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function HistoryTab() {
  const swapHistory = useSwapStore((s) => s.swapHistory)

  if (swapHistory.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No swap history yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="offers-table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>In</th>
            <th>Out</th>
            <th>Status</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          {swapHistory.map((entry) => {
            const explorer = BLOCK_EXPLORER[entry.chain as ChainKey] ?? BLOCK_EXPLORER.ethereum
            const statusVariant = entry.status === 'confirmed'
              ? 'success'
              : entry.status === 'failed'
                ? 'danger'
                : 'warning'

            return (
              <tr key={entry.hash}>
                <td>{entry.tokenInSymbol}{' -> '}{entry.tokenOutSymbol}</td>
                <td>{entry.amountIn}</td>
                <td>{entry.amountOut}</td>
                <td>
                  <Badge variant={statusVariant} className="capitalize">{entry.status}</Badge>
                </td>
                <td>
                  <a
                    href={`${explorer}/tx/${entry.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:text-primary/80"
                  >
                    {entry.hash.slice(0, 6)}...{entry.hash.slice(-4)}
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function DataTabs({ quote, tokenB }: DataTabsProps) {
  const [activeTab, setActiveTab] = useState<'offers' | 'pools' | 'history'>('offers')
  const swapHistory = useSwapStore((s) => s.swapHistory)

  const hasOffers = quote.offers && quote.offers.length > 0

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      className="w-full max-w-[560px]"
    >
      <Card className="bg-card">
        <CardContent className="p-4">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'offers' | 'pools' | 'history')}>
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-lg bg-muted p-1">
              <TabsTrigger value="offers" className="text-xs uppercase tracking-wide">
                Offers{hasOffers ? ` (${quote.offers!.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="pools" className="text-xs uppercase tracking-wide">
                Pools ({quote.sources.length})
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs uppercase tracking-wide">
                History{swapHistory.length > 0 ? ` (${swapHistory.length})` : ''}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="offers">
              <OffersTab quote={quote} tokenB={tokenB} />
            </TabsContent>

            <TabsContent value="pools">
              <PoolsTab quote={quote} />
            </TabsContent>

            <TabsContent value="history">
              <HistoryTab />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </motion.section>
  )
}
