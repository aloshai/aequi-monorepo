import { useState } from 'react'
import type { QuoteResponse, RouteToken } from '../types/api'

interface DataTabsProps {
  quote: QuoteResponse
  tokenB: RouteToken
}

function OffersTab({ quote, tokenB }: { quote: QuoteResponse; tokenB: RouteToken }) {
  if (!quote.offers || quote.offers.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '8px 0' }}>No alternative routes</div>
  }

  const bestAmount = Number(quote.offers[0]!.amountOut) / 10 ** tokenB.decimals

  return (
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

          let reason = ''
          if (!isBest) {
            const diff = ((bestAmount - offerAmount) / bestAmount * 100)
            if (diff > 0.5) reason = `${diff.toFixed(1)}% less`
            else if (offerImpact > quote.priceImpactBps / 100) reason = 'Higher impact'
            else reason = 'Higher gas'
          }

          return (
            <tr key={idx} className={isBest ? 'best-row' : ''}>
              <td>
                {offer.pools.map((p, i) => (
                  <span key={i} className="offer-source-tag" style={{ marginRight: 4 }}>
                    {p.dexId.split('-')[0]}
                  </span>
                ))}
              </td>
              <td>{offerAmount.toFixed(4)}</td>
              <td style={{ color: offerImpact > 5 ? 'var(--danger)' : offerImpact > 1 ? 'var(--warning)' : 'var(--text-primary)' }}>
                {offerImpact.toFixed(2)}%
              </td>
              <td style={{ color: 'var(--text-muted)' }}>{offerGas}</td>
              <td>
                {isBest ? (
                  <span className="best-badge">Best</span>
                ) : (
                  <span className="reason-text">{reason}</span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
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
          <div key={idx} className="pool-card">
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
                <span className="pool-card__label" style={{ fontStyle: 'italic' }}>Data unavailable</span>
                <span className="pool-card__value" />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function DataTabs({ quote, tokenB }: DataTabsProps) {
  const [activeTab, setActiveTab] = useState<'offers' | 'pools'>('offers')

  const hasOffers = quote.offers && quote.offers.length > 0

  return (
    <div className="data-tabs">
      <div className="data-tabs__nav">
        <button
          className={`data-tabs__tab ${activeTab === 'offers' ? 'data-tabs__tab--active' : ''}`}
          onClick={() => setActiveTab('offers')}
        >
          Offers{hasOffers ? ` (${quote.offers!.length})` : ''}
        </button>
        <button
          className={`data-tabs__tab ${activeTab === 'pools' ? 'data-tabs__tab--active' : ''}`}
          onClick={() => setActiveTab('pools')}
        >
          Pools ({quote.sources.length})
        </button>
      </div>
      <div className="data-tabs__content">
        {activeTab === 'offers' ? (
          <OffersTab quote={quote} tokenB={tokenB} />
        ) : (
          <PoolsTab quote={quote} />
        )}
      </div>
    </div>
  )
}
