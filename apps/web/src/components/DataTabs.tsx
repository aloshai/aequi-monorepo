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

const NATIVE_SYMBOL: Record<ChainKey, string> = {
  ethereum: 'ETH',
  bsc: 'BNB',
  incentiv: 'CENT',
}

const COMPACT_SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Q'] as const

function formatCompact(raw: string): string {
  const n = Number(raw)
  if (!Number.isFinite(n) || n === 0) return '0'
  const abs = Math.abs(n)
  const tier = Math.min(Math.floor(Math.log10(abs) / 3), COMPACT_SUFFIXES.length - 1)
  if (tier <= 0) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  const scaled = n / 10 ** (tier * 3)
  return `${scaled.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}${COMPACT_SUFFIXES[tier]}`
}

function fmtPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 })
  if (v >= 0.0001) return v.toFixed(6)
  return v.toPrecision(4)
}

function ReserveBar({ symbol0, symbol1, amount0, amount1 }: {
  symbol0: string; symbol1: string; amount0: number; amount1: number
}) {
  const total = amount0 + amount1
  const pct0 = total > 0 ? Math.max(2, Math.min(98, (amount0 / total) * 100)) : 50

  return (
    <div className="reserve-bar-container">
      <div className="reserve-bar-labels">
        <span className="reserve-bar-label">
          <span className="reserve-bar-dot reserve-bar-dot--left" />
          {symbol0} <span className="reserve-bar-amount">{formatCompact(String(amount0))}</span>
        </span>
        <span className="reserve-bar-label">
          <span className="reserve-bar-dot reserve-bar-dot--right" />
          {symbol1} <span className="reserve-bar-amount">{formatCompact(String(amount1))}</span>
        </span>
      </div>
      <div className="reserve-bar-track">
        <div className="reserve-bar-fill reserve-bar-fill--left" style={{ width: `${pct0}%` }} />
      </div>
      <div className="reserve-bar-pcts">
        <span>{pct0.toFixed(0)}%</span>
        <span>{(100 - pct0).toFixed(0)}%</span>
      </div>
    </div>
  )
}

interface DataTabsProps {
  quote: QuoteResponse
  tokenB: RouteToken
}

function OffersTab({ quote, tokenB }: { quote: QuoteResponse; tokenB: RouteToken }) {
  const nativeCurrency = NATIVE_SYMBOL[quote.chain] ?? 'ETH'
  if (!quote.offers || quote.offers.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">No alternative routes yet.</p>
  }

  const bestAmount = Number(quote.offers[0]!.amountOut) / 10 ** tokenB.decimals
  const lowestImpact = Math.min(...quote.offers.map((offer) => offer.priceImpactBps))
  const lowestGas = Math.min(...quote.offers.map((offer) => Number(offer.estimatedGasCostWei ?? Number.MAX_SAFE_INTEGER)))

  return (
    <div className="flex flex-col gap-2">
      {quote.offers.map((offer, idx) => {
        const isBest = idx === 0
        const offerAmount = Number(offer.amountOut) / 10 ** tokenB.decimals
        const offerImpact = offer.priceImpactBps / 100
        const gasVal = offer.estimatedGasCostWei ? Number(offer.estimatedGasCostWei) / 1e18 : null
        const gasGwei = offer.gasPriceWei ? (Number(offer.gasPriceWei) / 1e9).toFixed(1) : null
        const offerGas = gasVal != null
          ? `${gasVal.toFixed(5)} ${nativeCurrency}${gasGwei ? ` (${gasGwei} gwei)` : ''}`
          : '-'
        const gasNumber = Number(offer.estimatedGasCostWei ?? Number.MAX_SAFE_INTEGER)
        const isLowestImpact = offer.priceImpactBps === lowestImpact
        const isLowestGas = gasNumber === lowestGas
        const impactClass = offerImpact > 5 ? 'text-red-600' : offerImpact > 1 ? 'text-amber-600' : 'text-foreground'

        let reason = ''
        if (!isBest) {
          const diff = ((bestAmount - offerAmount) / bestAmount * 100)
          if (diff > 0.5) reason = `${diff.toFixed(1)}% less output`
          else if (offerImpact > quote.priceImpactBps / 100) reason = 'Higher impact'
          else reason = 'Higher gas'
        }

        return (
          <Card key={idx} className={`bg-background ${isBest ? 'ring-1 ring-primary/30' : ''}`}>
            <CardContent className="p-3">
              {/* Route header */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1">
                  {offer.pools.map((p, i) => (
                    <Badge key={`${p.poolAddress}-${i}`} variant="secondary" className="text-[10px] capitalize">
                      {p.dexId.split('-')[0]}{p.feeTier != null ? ` ${p.feeTier / 10000}%` : ''}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  {isBest && <Badge variant="success" className="text-[10px]">Best</Badge>}
                  {isLowestImpact && !isBest && <Badge variant="warning" className="text-[10px]">Low Impact</Badge>}
                  {isLowestGas && !isBest && <Badge variant="outline" className="text-[10px]">Low Gas</Badge>}
                  {!isBest && !isLowestImpact && !isLowestGas && (
                    <span className="reason-text">{reason}</span>
                  )}
                </div>
              </div>

              {/* Metrics row */}
              <div className="offer-metrics">
                <div className="offer-metric">
                  <span className="offer-metric__label">Output</span>
                  <span className="offer-metric__value">{offerAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>
                </div>
                <div className="offer-metric">
                  <span className="offer-metric__label">Impact</span>
                  <span className={`offer-metric__value ${impactClass}`}>{offerImpact.toFixed(2)}%</span>
                </div>
                <div className="offer-metric">
                  <span className="offer-metric__label">Gas</span>
                  <span className="offer-metric__value text-muted-foreground">{offerGas}</span>
                </div>
                <div className="offer-metric">
                  <span className="offer-metric__label">Hops</span>
                  <span className="offer-metric__value">{offer.hopVersions.join(' → ')}</span>
                </div>
              </div>

              {/* Per-source reserve bars */}
              {offer.sources.length > 0 && offer.sources.some(s => s.reserves) && (
                <div className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-1.5">
                  {offer.sources.map((source, si) => {
                    const tIn = offer.tokens[si]
                    const tOut = offer.tokens[si + 1]
                    if (!tIn || !tOut || !source.reserves) return null

                    const isT0In = source.reserves.token0?.toLowerCase() === tIn.address.toLowerCase()
                    const t0 = isT0In ? tIn : tOut
                    const t1 = isT0In ? tOut : tIn

                    let r0: number | null = null
                    let r1: number | null = null
                    if (source.reserves.reserve0 && source.reserves.reserve1) {
                      r0 = Number(source.reserves.reserve0) / 10 ** t0.decimals
                      r1 = Number(source.reserves.reserve1) / 10 ** t1.decimals
                    } else if (source.reserves.liquidity && source.reserves.sqrtPriceX96) {
                      const L = Number(BigInt(source.reserves.liquidity))
                      const sqrtP = Number(BigInt(source.reserves.sqrtPriceX96)) / 2 ** 96
                      if (sqrtP > 0) {
                        r0 = (L / sqrtP) / 10 ** t0.decimals
                        r1 = (L * sqrtP) / 10 ** t1.decimals
                      }
                    }

                    if (r0 == null || r1 == null || r0 <= 0 || r1 <= 0 || !Number.isFinite(r0) || !Number.isFinite(r1)) return null

                    return (
                      <ReserveBar key={si} symbol0={t0.symbol} symbol1={t1.symbol} amount0={r0} amount1={r1} />
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
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

        const isToken0In = source.reserves?.token0?.toLowerCase() === tokenIn.address.toLowerCase()
        const token0Info = isToken0In ? tokenIn : tokenOut
        const token1Info = isToken0In ? tokenOut : tokenIn

        // Compute price ratio from sqrtPriceX96 for V3 pools
        let priceLabel: string | null = null
        if (source.reserves?.sqrtPriceX96) {
          const sqrtPNum = Number(BigInt(source.reserves.sqrtPriceX96)) / 2 ** 96
          const rawPrice = sqrtPNum * sqrtPNum
          const decimalAdj = 10 ** (token0Info.decimals - token1Info.decimals)
          const p = rawPrice * decimalAdj
          if (p > 0 && Number.isFinite(p)) {
            priceLabel = `1 ${token0Info.symbol} = ${fmtPrice(p)} ${token1Info.symbol}`
          }
        }

        // Reserve amounts for ratio bar
        // V2: use reserve0/reserve1 directly
        // V3: compute virtual reserves from liquidity + sqrtPriceX96
        let r0Raw: number | null = null
        let r1Raw: number | null = null

        if (source.reserves?.reserve0 && source.reserves?.reserve1) {
          r0Raw = Number(source.reserves.reserve0) / 10 ** token0Info.decimals
          r1Raw = Number(source.reserves.reserve1) / 10 ** token1Info.decimals
        } else if (source.reserves?.liquidity && source.reserves?.sqrtPriceX96) {
          const L = Number(BigInt(source.reserves.liquidity))
          const sqrtP = Number(BigInt(source.reserves.sqrtPriceX96)) / 2 ** 96
          if (sqrtP > 0) {
            r0Raw = (L / sqrtP) / 10 ** token0Info.decimals
            r1Raw = (L * sqrtP) / 10 ** token1Info.decimals
          }
        }
        const hasReserves = r0Raw != null && r1Raw != null && r0Raw > 0 && r1Raw > 0 && Number.isFinite(r0Raw) && Number.isFinite(r1Raw)

        return (
          <Card key={`${source.poolAddress ?? source.dexId}-${idx}`} className="bg-background">
            <CardContent className="p-3">
              <div className="pool-card__header">
                <div className="flex items-center gap-1.5">
                  <span className="pool-card__dex">{source.dexId.split('-')[0]}</span>
                  {source.feeTier != null && (
                    <span className="pool-card__fee-badge">{source.feeTier / 10000}%</span>
                  )}
                </div>
                <span className="pool-card__pair">{tokenIn.symbol}/{tokenOut.symbol}</span>
              </div>

              {source.reserves ? (
                <div className="flex flex-col gap-1">
                  {/* Liquidity (V3) */}
                  {source.reserves.liquidity && (
                    <div className="pool-card__row">
                      <span className="pool-card__label">Liquidity</span>
                      <span className="pool-card__value">{formatCompact(source.reserves.liquidity)}</span>
                    </div>
                  )}

                  {/* Price ratio */}
                  {priceLabel && (
                    <div className="pool-card__row">
                      <span className="pool-card__label">Price</span>
                      <span className="pool-card__value text-xs">{priceLabel}</span>
                    </div>
                  )}

                  {/* Reserve ratio bar */}
                  {hasReserves && (
                    <ReserveBar
                      symbol0={token0Info.symbol}
                      symbol1={token1Info.symbol}
                      amount0={r0Raw!}
                      amount1={r1Raw!}
                    />
                  )}
                </div>
              ) : (
                <div className="pool-card__row">
                  <span className="pool-card__label italic text-xs">Data unavailable</span>
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
