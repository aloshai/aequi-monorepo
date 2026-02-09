import type { QuoteResponse, RouteToken } from '../types/api'
import { getTokenLogo } from '../utils/logos'

const NATIVE_SYMBOL: Record<string, string> = {
  ethereum: 'ETH',
  bsc: 'BNB',
}

interface QuoteAnalysisProps {
  quote: QuoteResponse
  tokenA: RouteToken
  tokenB: RouteToken
}

export function QuoteAnalysis({ quote, tokenA, tokenB }: QuoteAnalysisProps) {
  const nativeCurrency = NATIVE_SYMBOL[quote.chain] ?? 'ETH'

  const gasCostDisplay = quote.estimatedGasCostWei
    ? (Number(quote.estimatedGasCostWei) / 10 ** 18).toFixed(6)
    : 'Unknown'

  const priceImpact = quote.priceImpactBps / 100
  const priceImpactColor =
    priceImpact > 5
      ? 'var(--danger-color)'
      : priceImpact > 1
        ? '#e6a23c'
        : 'var(--accent-color)'

  const midPriceBig = BigInt(quote.midPriceQ18)
  const execPriceBig = BigInt(quote.executionPriceQ18)
  const spread = midPriceBig > 0n
    ? Number((midPriceBig - execPriceBig) * 10000n / midPriceBig) / 100
    : 0

  return (
    <div className="quote-analysis-container">
      {/* 1. Route Visualization */}
      <div className="analysis-card route-card">
        <div className="card-label">Routing Path</div>
        <div className="route-visualizer">
          {quote.tokens.map((token, idx) => {
            const isLast = idx === quote.tokens.length - 1
            const pool = !isLast ? quote.pools[idx] : null
            
            return (
              <div key={token.address} className="route-step">
                <div className="route-token">
                  <img 
                    src={getTokenLogo(token.symbol)} 
                    alt={token.symbol} 
                    className="route-token-icon"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                  <span className="route-token-symbol">{token.symbol}</span>
                </div>
                
                {!isLast && pool && (
                  <div className="route-connector">
                    <div className="connector-line"></div>
                    <div className="pool-badge">
                      <span className="pool-dex">{pool.dexId.split('-')[0]}</span>
                      {pool.feeTier && <span className="pool-fee">{pool.feeTier / 10000}%</span>}
                      <span className="pool-version">{quote.hopVersions[idx]}</span>
                    </div>
                    <div className="connector-line"></div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 2. Market Data Grid */}
      <div className="analysis-grid">
        <div className="analysis-card">
          <div className="card-label">Rate & Spread</div>
          <div className="stat-row">
            <span className="stat-label">1 {tokenA.symbol} =</span>
            <span className="stat-value">
              {(Number(quote.amountOut) / 10 ** tokenB.decimals / Number(quote.amountInFormatted)).toFixed(6)} {tokenB.symbol}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Price Impact</span>
            <span className="stat-value" style={{ color: priceImpactColor }}>
              {priceImpact.toFixed(2)}%
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Realized Spread</span>
            <span className="stat-value">
              {spread.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="analysis-card">
          <div className="card-label">Network Costs</div>
          <div className="stat-row">
            <span className="stat-label">Est. Gas Cost</span>
            <span className="stat-value">{gasCostDisplay} {nativeCurrency}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Gas Units</span>
            <span className="stat-value">{Number(quote.estimatedGasUnits).toLocaleString()}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Gas Price</span>
            <span className="stat-value">{(Number(quote.gasPriceWei) / 10 ** 9).toFixed(2)} Gwei</span>
          </div>
        </div>
      </div>

      {/* 3. Alternative Routes Table */}
      {quote.offers && quote.offers.length > 0 && (
        <div className="analysis-card">
          <div className="card-label">Route Comparison</div>
          <div className="offers-table">
            <div className="offers-header">
              <div>Route</div>
              <div>Fee</div>
              <div>Output</div>
              <div>Price Impact</div>
              <div>Liquidity</div>
              <div>Gas</div>
              <div>Status</div>
            </div>
            {quote.offers.map((offer, idx) => {
               const isBest = idx === 0;
               const offerAmount = Number(offer.amountOut) / 10 ** tokenB.decimals;
               const bestAmount = Number(quote.offers![0]!.amountOut) / 10 ** tokenB.decimals;
               const offerGas = offer.estimatedGasCostWei 
                 ? (Number(offer.estimatedGasCostWei) / 10 ** 18).toFixed(5) 
                 : '-';
               const offerImpact = offer.priceImpactBps / 100;
               const impactColor = offerImpact > 5 ? 'var(--danger-color)' : offerImpact > 1 ? '#e6a23c' : 'var(--accent-color)';
               const liquidity = (Number(offer.liquidityScore) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 });
               
               // Calculate average fee
               const avgFee = offer.pools.length > 0 
                 ? offer.pools.reduce((sum, p) => sum + (p.feeTier || 0), 0) / offer.pools.length / 10000
                 : 0;
               
               // Determine why not selected
               let reason = '';
               if (!isBest) {
                 const outputDiff = ((bestAmount - offerAmount) / bestAmount * 100);
                 if (outputDiff > 0.5) {
                   reason = `${outputDiff.toFixed(2)}% lower output`;
                 } else if (offerImpact > quote.priceImpactBps / 100) {
                   reason = 'Higher price impact';
                 } else if (Number(offer.liquidityScore) < Number(quote.offers![0]!.liquidityScore)) {
                   reason = 'Lower liquidity';
                 } else {
                   reason = 'Higher gas cost';
                 }
               }
               
               return (
                 <div key={idx} className={`offer-row ${isBest ? 'best-offer' : ''}`}>
                   <div className="offer-route-col">
                     <div className="offer-sources">
                       {offer.pools.map((p, i) => (
                         <span key={i} className="offer-source-tag">
                           {p.dexId.split('-')[0]}
                         </span>
                       ))}
                     </div>
                     <span className="offer-hops">{offer.hopVersions.length} Hop{offer.hopVersions.length > 1 ? 's' : ''}</span>
                   </div>
                   <div className="offer-fee-col">
                     {avgFee > 0 ? `${avgFee.toFixed(2)}%` : '-'}
                   </div>
                   <div className="offer-amount-col">
                     <span className="offer-val">{offerAmount.toFixed(4)}</span>
                   </div>
                   <div className="offer-impact-col">
                     <span className="offer-val" style={{ color: impactColor }}>
                       {offerImpact.toFixed(2)}%
                     </span>
                   </div>
                   <div className="offer-liquidity-col">
                     <span className="offer-val">{liquidity}</span>
                   </div>
                   <div className="offer-gas-col">
                     {offerGas}
                   </div>
                   <div className="offer-status-col">
                     {isBest ? (
                       <span className="best-badge-mini">✓ Selected</span>
                     ) : (
                       <span className="reason-text">{reason}</span>
                     )}
                   </div>
                 </div>
               )
            })}
          </div>
        </div>
      )}
      
      {/* 4. Technical Details */}
      <div className="analysis-card">
         <div className="card-label">Technical Data</div>
         <div className="tech-grid">
            <div className="tech-item">
                <span className="tech-label">Liquidity Score</span>
                <span className="tech-val" title={quote.liquidityScore}>
                    {(Number(quote.liquidityScore) / 1e18).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
            </div>
            <div className="tech-item">
                <span className="tech-label">Block Number</span>
                <span className="tech-val">Latest</span>
            </div>
            <div className="tech-item">
                <span className="tech-label">Router</span>
                <span className="tech-val">AequiExecutor</span>
            </div>
         </div>
      </div>

      {/* 5. Pool Liquidity Details */}
      <div className="analysis-card">
        <div className="card-label">Pool Liquidity</div>
        <div className="liquidity-grid">
          {quote.sources.map((source, idx) => {
            const tokenIn = quote.tokens[idx]
            const tokenOut = quote.tokens[idx + 1]
            
            if (!tokenIn || !tokenOut) return null

            return (
              <div key={idx} className="liquidity-item">
                <div className="liquidity-header">
                  <span className="liquidity-dex">{source.dexId.split('-')[0]}</span>
                  <span className="liquidity-pair">{tokenIn.symbol}/{tokenOut.symbol}</span>
                </div>
                {source.reserves ? (
                  <div className="liquidity-values">
                    {source.reserves.liquidity ? (
                      <div className="liquidity-row">
                        <span className="liquidity-label">Liquidity (L):</span>
                        <span className="liquidity-val">{Number(source.reserves.liquidity).toExponential(2)}</span>
                      </div>
                    ) : (
                      <>
                        <div className="liquidity-row">
                          <span className="liquidity-label">
                            {source.reserves.token0?.toLowerCase() === tokenIn.address.toLowerCase() ? tokenIn.symbol : tokenOut.symbol}:
                          </span>
                          <span className="liquidity-val">
                            {(Number(source.reserves.reserve0) / 10 ** (source.reserves.token0?.toLowerCase() === tokenIn.address.toLowerCase() ? tokenIn.decimals : tokenOut.decimals)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                        <div className="liquidity-row">
                          <span className="liquidity-label">
                            {source.reserves.token1?.toLowerCase() === tokenIn.address.toLowerCase() ? tokenIn.symbol : tokenOut.symbol}:
                          </span>
                          <span className="liquidity-val">
                            {(Number(source.reserves.reserve1) / 10 ** (source.reserves.token1?.toLowerCase() === tokenIn.address.toLowerCase() ? tokenIn.decimals : tokenOut.decimals)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="liquidity-values">
                    <span className="text-secondary" style={{ fontSize: '0.8rem' }}>Data unavailable</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
