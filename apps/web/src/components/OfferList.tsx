import type { PriceResponse } from '../types/api'
import type { Token } from '../services/token-manager'
import { getDexLogo, getTokenLogo } from '../utils/logos'

const NATIVE_SYMBOL: Record<string, string> = {
    ethereum: 'ETH',
    bsc: 'BNB',
}

interface OfferListProps {
    offers: PriceResponse[]
    tokenB: Token
    onSelect?: (offer: PriceResponse) => void
}

export function OfferList({ offers, tokenB, onSelect }: OfferListProps) {
    if (!offers || offers.length === 0) {
        return null
    }

    return (
        <div className="offer-list-container">
            <h3 className="offer-list-title">Alternative Offers</h3>
            <div className="offer-list">
                {offers.map((offer, index) => {
                    // Assuming the first source is the main one for logo display
                    // In a multi-hop, it might be mixed, but usually we show the primary DEX or "Multi-Hop"
                    const dexName = offer.sources[0]?.dexId.split(':')[0] || 'Unknown'
                    // Capitalize first letter
                    const displayDexName = dexName.charAt(0).toUpperCase() + dexName.slice(1)
                    const logoUrl = getDexLogo(displayDexName)
                    const tokenLogoUrl = tokenB.logoURI || getTokenLogo(tokenB.symbol)

                    const amountOut = Number(offer.amountOut) / 10 ** tokenB.decimals
                    const gasCost = offer.estimatedGasCostWei
                        ? (Number(offer.estimatedGasCostWei) / 10 ** 18).toFixed(6)
                        : 'Unknown'

                    return (
                        <div key={index} className="offer-item" onClick={() => onSelect?.(offer)}>
                            <div className="offer-dex">
                                {logoUrl ? (
                                    <img src={logoUrl} alt={displayDexName} className="dex-logo" />
                                ) : (
                                    <div className="dex-logo-placeholder">{displayDexName[0]}</div>
                                )}
                                <span className="dex-name">{displayDexName}</span>
                                {offer.hopVersions.length > 1 && <span className="hop-badge">Multi</span>}
                            </div>

                            <div className="offer-details">
                                <div className="offer-amount">
                                    {tokenLogoUrl && <img src={tokenLogoUrl} alt={tokenB.symbol} className="token-icon" />}
                                    {amountOut.toFixed(6)} {tokenB.symbol}
                                </div>
                                <div className="offer-gas">
                                    Gas: ~{gasCost} {NATIVE_SYMBOL[offer.chain] ?? 'ETH'}
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
