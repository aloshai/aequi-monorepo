import type { QuoteResponse, RouteToken } from '../types/api'

interface QuoteDetailsProps {
  quote: QuoteResponse
  tokenA: RouteToken
  tokenB: RouteToken
}

const NATIVE_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',
  bsc: 'BNB',
}

export function QuoteDetails({ quote, tokenA, tokenB }: QuoteDetailsProps) {
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
    priceImpact > 5 ? 'quote-detail-row__value--danger' :
    priceImpact > 1 ? 'quote-detail-row__value--warning' :
    ''

  return (
    <div className="quote-details">
      <div className="quote-detail-row">
        <span className="quote-detail-row__label">Rate</span>
        <span className="quote-detail-row__value">
          1 {tokenA.symbol} = {rate.toFixed(6)} {tokenB.symbol}
        </span>
      </div>
      <div className="quote-detail-row">
        <span className="quote-detail-row__label">Price Impact</span>
        <span className={`quote-detail-row__value ${impactClass}`}>
          {priceImpact.toFixed(2)}%
        </span>
      </div>
      <div className="quote-detail-row">
        <span className="quote-detail-row__label">Spread</span>
        <span className="quote-detail-row__value">{spread.toFixed(2)}%</span>
      </div>
      {gasCost && (
        <div className="quote-detail-row">
          <span className="quote-detail-row__label">Gas</span>
          <span className="quote-detail-row__value">
            {gasCost} {nativeCurrency} {gasGwei && `(${gasGwei} gwei)`}
          </span>
        </div>
      )}
      <div className="quote-detail-row">
        <span className="quote-detail-row__label">Route</span>
        <span className="quote-detail-row__value">
          {quote.isSplit ? `Split (${quote.splits?.length} legs)` : `${quote.tokens.length - 1} hop${quote.tokens.length > 2 ? 's' : ''}`}
          {' · '}
          {quote.routePreference.toUpperCase()}
        </span>
      </div>
      <div className="quote-detail-row">
        <span className="quote-detail-row__label">Min. Received</span>
        <span className="quote-detail-row__value">
          {quote.amountOutMinFormatted} {tokenB.symbol}
        </span>
      </div>
    </div>
  )
}
