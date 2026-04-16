import type { PriceQuote } from '@aequi/core'
import {
  BaseDexAdapter,
  type V3QuoteParams,
} from '@aequi/pricing'
import { UniswapV3Adapter } from '../uniswap/uniswap-v3-adapter'

/**
 * IncentivePortalV3 is a Uniswap V3 fork on the Incentiv network.
 * Delegates V3 quote computation to the canonical UniswapV3Adapter instance
 * while registering under a distinct protocol identifier.
 */
export class IncentivePortalV3Adapter extends BaseDexAdapter {
  readonly protocol = 'incentive-portal'
  readonly version = 'v3' as const

  private readonly delegate = new UniswapV3Adapter()

  async computeV3Quote(params: V3QuoteParams): Promise<PriceQuote | null> {
    return this.delegate.computeV3Quote(params)
  }
}
