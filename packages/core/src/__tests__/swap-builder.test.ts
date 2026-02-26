import { describe, it, expect } from 'vitest'
import { SwapBuilder } from '../swap-builder'
import type { ChainConfig, PriceQuote, TokenMetadata } from '../types'
import type { Address } from 'viem'
import { getAddress } from 'viem'
import { bsc } from 'viem/chains'

const TEST_EXECUTOR = getAddress('0x1111111111111111111111111111111111111111')
const ROUTER = getAddress('0x2222222222222222222222222222222222222222')
const WBNB = getAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
const TOKEN_A_ADDR = getAddress('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa')
const TOKEN_B_ADDR = getAddress('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB')
const RECIPIENT = getAddress('0x3333333333333333333333333333333333333333')
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const POOL_ADDR = getAddress('0x4444444444444444444444444444444444444444')

const tokenA: TokenMetadata = {
  chainId: 56, address: TOKEN_A_ADDR, symbol: 'TKA', name: 'TokenA', decimals: 18, totalSupply: null,
}

const tokenB: TokenMetadata = {
  chainId: 56, address: TOKEN_B_ADDR, symbol: 'TKB', name: 'TokenB', decimals: 18, totalSupply: null,
}

const makeChain = (): ChainConfig => ({
  key: 'bsc',
  id: 56,
  name: 'BNB Smart Chain',
  nativeCurrencySymbol: 'BNB',
  wrappedNativeAddress: WBNB,
  rpcUrls: ['https://bsc-dataseed.binance.org'],
  viemChain: bsc,
  dexes: [{
    id: 'pancakeswap-v2',
    label: 'PancakeSwap V2',
    protocol: 'pancakeswap',
    version: 'v2',
    factoryAddress: getAddress('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'),
    routerAddress: ROUTER,
  }],
})

const makeQuote = (overrides: Partial<PriceQuote> = {}): PriceQuote => ({
  chain: 'bsc',
  amountIn: 1000000000000000000n,
  amountOut: 500000000000000000n,
  priceQ18: 500000000000000000n,
  executionPriceQ18: 500000000000000000n,
  midPriceQ18: 510000000000000000n,
  priceImpactBps: 50,
  path: [tokenA, tokenB],
  routeAddresses: [TOKEN_A_ADDR, TOKEN_B_ADDR],
  sources: [{
    dexId: 'pancakeswap-v2',
    poolAddress: POOL_ADDR,
    amountIn: 1000000000000000000n,
    amountOut: 500000000000000000n,
  }],
  liquidityScore: 100n,
  hopVersions: ['v2'],
  estimatedGasUnits: 200000n,
  estimatedGasCostWei: 1000000000000000n,
  gasPriceWei: 5000000000n,
  ...overrides,
})

describe('SwapBuilder', () => {
  const builder = new SwapBuilder({
    executorByChain: { ethereum: null, bsc: TEST_EXECUTOR },
    interhopBufferBps: 10,
  })

  it('throws on missing sources', () => {
    expect(() => builder.build(makeChain(), {
      quote: makeQuote({ sources: [] }),
      amountOutMin: 475n,
      recipient: RECIPIENT,
      slippageBps: 50,
      deadlineSeconds: 600,
    })).toThrow('Quote is missing source information')
  })

  it('throws on zero-address recipient', () => {
    expect(() => builder.build(makeChain(), {
      quote: makeQuote(),
      amountOutMin: 475n,
      recipient: ZERO,
      slippageBps: 50,
      deadlineSeconds: 600,
    })).toThrow('Invalid recipient address')
  })

  it('builds a valid executor swap transaction', () => {
    const tx = builder.build(makeChain(), {
      quote: makeQuote(),
      amountOutMin: 475000000000000000n,
      recipient: RECIPIENT,
      slippageBps: 50,
      deadlineSeconds: 600,
    })

    expect(tx.kind).toBe('executor')
    expect(tx.amountIn).toBe(1000000000000000000n)
    expect(tx.amountOut).toBe(500000000000000000n)
    expect(tx.amountOutMinimum).toBe(475000000000000000n)
    expect(tx.spender).toBe(TEST_EXECUTOR)
    expect(tx.call.to).toBeTruthy()
    expect(tx.call.data).toBeTruthy()
  })

  it('clamps slippage to 0 for negative values', () => {
    const tx = builder.build(makeChain(), {
      quote: makeQuote(),
      amountOutMin: 0n,
      recipient: RECIPIENT,
      slippageBps: -50,
      deadlineSeconds: 600,
    })

    expect(tx.amountOutMinimum).toBe(makeQuote().amountOut)
  })

  it('clamps slippage to 1000 for excessive values', () => {
    const tx = builder.build(makeChain(), {
      quote: makeQuote(),
      amountOutMin: 0n,
      recipient: RECIPIENT,
      slippageBps: 5000,
      deadlineSeconds: 600,
    })

    const expected = makeQuote().amountOut - (makeQuote().amountOut * 1000n / 10000n)
    expect(tx.amountOutMinimum).toBe(expected)
  })

  it('uses default deadline when deadlineSeconds is 0', () => {
    const tx = builder.build(makeChain(), {
      quote: makeQuote(),
      amountOutMin: 475000000000000000n,
      recipient: RECIPIENT,
      slippageBps: 50,
      deadlineSeconds: 0,
    })

    const now = Math.floor(Date.now() / 1000)
    expect(tx.deadline).toBeGreaterThanOrEqual(now + 170)
    expect(tx.deadline).toBeLessThanOrEqual(now + 190)
  })

  it('throws when executor is not configured for chain', () => {
    const noExecutorBuilder = new SwapBuilder({
      executorByChain: { ethereum: null, bsc: null },
      interhopBufferBps: 10,
    })

    expect(() => noExecutorBuilder.build(makeChain(), {
      quote: makeQuote(),
      amountOutMin: 475n,
      recipient: RECIPIENT,
      slippageBps: 50,
      deadlineSeconds: 600,
    })).toThrow()
  })
})
