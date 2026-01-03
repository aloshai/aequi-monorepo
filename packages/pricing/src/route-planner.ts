import type { PriceQuote } from '@aequi/core'
import { compareQuotes } from './quote-math'

export const selectBestQuote = (quotes: PriceQuote[]): PriceQuote | null => {
  if (!quotes.length) {
    console.log('[RoutePlanner] No quotes to select from')
    return null
  }
  console.log(`[RoutePlanner] Selecting best quote from ${quotes.length} candidates`)
  const [best] = quotes.sort(compareQuotes)
  
  if (best) {
    console.log(`[RoutePlanner] Best quote selected: ${best.amountOut} out via ${best.sources.map(s => s.dexId).join(' -> ')}`)
  }
  
  return best ?? null
}
