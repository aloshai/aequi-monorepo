import type { QuoteResponse, RouteToken } from '../types/api'
import { getTokenLogo } from '../utils/logos'

interface RouteVisualProps {
  quote: QuoteResponse
  tokenB: RouteToken
}

function RouteTokenNode({ symbol }: { symbol: string }) {
  const logo = getTokenLogo(symbol)
  return (
    <span className="route-node">
      {logo && <img src={logo} alt={symbol} className="route-node__icon" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      {symbol}
    </span>
  )
}

function PoolConnector({ dexId, feeTier, version }: { dexId: string; feeTier?: number | null; version?: string }) {
  const dexName = dexId.split('-')[0]
  const fee = feeTier ? `${feeTier / 10000}%` : ''
  return (
    <span className="route-connector">
      <span className="route-connector__arrow">→</span>
      <span className="route-connector__pool">
        {dexName}{version ? ` ${version}` : ''}{fee ? ` · ${fee}` : ''}
      </span>
    </span>
  )
}

function SingleRoute({ quote }: { quote: QuoteResponse }) {
  return (
    <div className="route-path">
      {quote.tokens.map((token, idx) => {
        const isLast = idx === quote.tokens.length - 1
        const pool = !isLast ? quote.pools[idx] : null
        return (
          <span key={token.address} style={{ display: 'contents' }}>
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
  return (
    <div className="route-visual">
      <div className="route-visual__header">
        Route
        {quote.isSplit && <span className="route-visual__split-badge">Split</span>}
      </div>

      {quote.isSplit && quote.splits ? (
        <div>
          {quote.splits.map((leg, i) => (
            <div key={i} className="split-leg">
              <div className="split-leg__header">
                <span className="split-leg__ratio">{(leg.ratioBps / 100).toFixed(0)}%</span>
                <span className="split-leg__source">{leg.quote.source}</span>
                <span className="split-leg__amount">
                  {(Number(leg.quote.amountOut) / 10 ** tokenB.decimals).toFixed(4)} {tokenB.symbol}
                </span>
              </div>
              <div className="route-path">
                {leg.quote.tokens.map((token, idx) => {
                  const isLast = idx === leg.quote.tokens.length - 1
                  const pool = !isLast ? leg.quote.pools[idx] : null
                  return (
                    <span key={token.address} style={{ display: 'contents' }}>
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
    </div>
  )
}
