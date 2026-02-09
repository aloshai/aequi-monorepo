import type { Address } from 'viem'
import type { ChainConfig, QuoteResult, RoutePreference } from '@aequi/core'
import { parseAmountToUnits } from '../../utils/units'
import { clampSlippage } from '../../utils/trading'
import { PriceService } from '@aequi/pricing'
import { TokenService } from '@aequi/pricing'

interface Logger {
  info(msg: string): void
  info(obj: object, msg: string): void
  debug(msg: string): void
  debug(obj: object, msg: string): void
}

const noop: Logger = { info() {}, debug() {} }

export class QuoteService {
  constructor(
    private readonly tokenService: TokenService,
    private readonly priceService: PriceService,
    private readonly logger: Logger = noop,
  ) {}

  async getQuote(
    chain: ChainConfig,
    tokenInAddress: Address,
    tokenOutAddress: Address,
    amount: string,
    slippageBps: number,
    preference: RoutePreference = 'auto',
    forceMultiHop: boolean = false,
    enableSplit?: boolean,
  ): Promise<QuoteResult | null> {
    if (tokenInAddress.toLowerCase() === tokenOutAddress.toLowerCase()) {
      return null
    }

    const [tokenIn, tokenOut] = await Promise.all([
      this.tokenService.getTokenMetadata(chain, tokenInAddress),
      this.tokenService.getTokenMetadata(chain, tokenOutAddress),
    ])

    const amountIn = parseAmountToUnits(amount, tokenIn.decimals)
    if (amountIn <= 0n) {
      throw new Error('Amount must be greater than zero')
    }

    this.logger.info({ pair: `${tokenIn.symbol}->${tokenOut.symbol}`, amountIn: amountIn.toString() }, 'Requesting quote')
    const quote = await this.priceService.getBestQuoteForTokens(chain, tokenIn, tokenOut, amountIn, preference, forceMultiHop, enableSplit)
    if (!quote) {
      this.logger.debug('No quote returned from PriceService')
      return null
    }
    this.logger.info({ amountOut: quote.amountOut.toString() }, 'Quote received')

    const boundedSlippage = clampSlippage(slippageBps)
    const slippageAmount = (quote.amountOut * BigInt(boundedSlippage)) / 10000n
    const amountOutMin = quote.amountOut > slippageAmount ? quote.amountOut - slippageAmount : 0n

    return {
      quote,
      amountOutMin,
      slippageBps: boundedSlippage,
      tokenIn,
      tokenOut,
    }
  }
}
