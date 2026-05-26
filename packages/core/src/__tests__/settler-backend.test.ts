import { describe, it, expect } from 'vitest'
import { decodeAbiParameters, decodeFunctionData, getAddress } from 'viem'
import type { Address } from 'viem'
import { bsc } from 'viem/chains'
import { SettlerBackend } from '../settler-backend'
import {
  ALLOWANCE_HOLDER_ADDRESS,
  SETTLER_ACTION_SELECTORS,
  SETTLER_ETH_ADDRESS,
} from '../settler-types'
import { ALLOWANCE_HOLDER_ABI, SETTLER_EXECUTE_ABI } from '../abi'
import type { ChainConfig, PriceQuote, TokenMetadata } from '../types'

// ---- Fixtures ---------------------------------------------------------------

const SETTLER_ADDR = getAddress('0xC0fFee0000000000000000000000000000000001')
const PERMIT2_ADDR = getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')
const WBNB = getAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
const TOKEN_A = getAddress('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa')
const TOKEN_B = getAddress('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB')
const TOKEN_C = getAddress('0xcccCCcCccccCCCccCCCcCcCcccCcCcCcccCcCcCc')
const RECIPIENT = getAddress('0x3333333333333333333333333333333333333333')
const FEE_RECIPIENT = getAddress('0xFEE1000000000000000000000000000000000005')
const POOL_AB = getAddress('0x4444444444444444444444444444444444444444')
const POOL_BC = getAddress('0x5555555555555555555555555555555555555555')

const tokenA: TokenMetadata = {
  chainId: 56,
  address: TOKEN_A,
  symbol: 'TKA',
  name: 'TokenA',
  decimals: 18,
  totalSupply: null,
}
const tokenB: TokenMetadata = {
  chainId: 56,
  address: TOKEN_B,
  symbol: 'TKB',
  name: 'TokenB',
  decimals: 18,
  totalSupply: null,
}
const tokenC: TokenMetadata = {
  chainId: 56,
  address: TOKEN_C,
  symbol: 'TKC',
  name: 'TokenC',
  decimals: 18,
  totalSupply: null,
}

const makeChain = (): ChainConfig => ({
  key: 'bsc',
  id: 56,
  name: 'BNB Smart Chain',
  nativeCurrencySymbol: 'BNB',
  wrappedNativeAddress: WBNB,
  rpcUrls: ['https://bsc-dataseed.binance.org'],
  viemChain: bsc,
  settler: {
    settler: SETTLER_ADDR,
    settlerMetaTxn: null,
    allowanceHolder: ALLOWANCE_HOLDER_ADDRESS,
    permit2: PERMIT2_ADDR,
  },
  dexes: [
    {
      id: 'pancake-v2',
      label: 'PancakeSwap V2',
      protocol: 'pancakeswap',
      version: 'v2',
      factoryAddress: getAddress('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'),
      routerAddress: getAddress('0x10ED43C718714eb63d5aA57B78B54704E256024E'),
    },
    {
      id: 'pancake-v3',
      label: 'PancakeSwap V3',
      protocol: 'pancakeswap',
      version: 'v3',
      factoryAddress: getAddress('0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'),
      routerAddress: getAddress('0x1b81D678ffb9C0263b24A97847620C99d213eB14'),
      feeTiers: [500, 2500, 10_000],
    },
  ],
})

const baseQuote = (overrides: Partial<PriceQuote> = {}): PriceQuote => ({
  chain: 'bsc',
  amountIn: 1_000_000_000_000_000_000n,
  amountOut: 500_000_000_000_000_000n,
  priceQ18: 500_000_000_000_000_000n,
  executionPriceQ18: 500_000_000_000_000_000n,
  midPriceQ18: 510_000_000_000_000_000n,
  priceImpactBps: 50,
  path: [tokenA, tokenB],
  routeAddresses: [TOKEN_A, TOKEN_B],
  sources: [
    {
      dexId: 'pancake-v2',
      poolAddress: POOL_AB,
      amountIn: 1_000_000_000_000_000_000n,
      amountOut: 500_000_000_000_000_000n,
    },
  ],
  liquidityScore: 100n,
  hopVersions: ['v2'],
  estimatedGasUnits: 200_000n,
  estimatedGasCostWei: 1_000_000_000_000_000n,
  gasPriceWei: 5_000_000_000n,
  ...overrides,
})

// ---- Helpers ---------------------------------------------------------------

/** Decode the outer AllowanceHolder.exec call and the inner Settler.execute. */
const decodeOuter = (data: `0x${string}`) => {
  const decoded = decodeFunctionData({ abi: ALLOWANCE_HOLDER_ABI, data })
  expect(decoded.functionName).toBe('exec')
  const [operator, token, amount, target, inner] = decoded.args as [
    Address,
    Address,
    bigint,
    Address,
    `0x${string}`,
  ]
  const innerDecoded = decodeFunctionData({ abi: SETTLER_EXECUTE_ABI, data: inner })
  expect(innerDecoded.functionName).toBe('execute')
  const [slippage, actions, zid] = innerDecoded.args as [
    { recipient: Address; buyToken: Address; minAmountOut: bigint },
    readonly `0x${string}`[],
    `0x${string}`,
  ]
  return { operator, token, amount, target, slippage, actions, zid }
}

const selectorOf = (actionBytes: `0x${string}`) =>
  actionBytes.slice(0, 10).toLowerCase() // 0x + 4 bytes

// ---- Tests -----------------------------------------------------------------

describe('SettlerBackend.build (AllowanceHolder mode)', () => {
  const backend = new SettlerBackend()

  it('single-hop V2: outer call targets AllowanceHolder, inner targets Settler', () => {
    const result = backend.build({
      quote: baseQuote(),
      recipient: RECIPIENT,
      amountOutMin: 475_000_000_000_000_000n,
      useNativeInput: false,
      useNativeOutput: false,
      tokenFlow: 'allowance-holder',
      chain: makeChain(),
      fee: null,
      deadlineSeconds: 600,
    })

    expect(result.kind).toBe('settler-allowance-holder')
    expect(result.to).toBe(ALLOWANCE_HOLDER_ADDRESS)
    expect(result.settler).toBe(SETTLER_ADDR)
    expect(result.value).toBe(0n)

    const decoded = decodeOuter(result.data)
    expect(decoded.operator).toBe(SETTLER_ADDR)
    expect(decoded.target).toBe(SETTLER_ADDR)
    expect(decoded.token).toBe(TOKEN_A)
    expect(decoded.amount).toBe(1_000_000_000_000_000_000n)

    expect(decoded.slippage.recipient).toBe(RECIPIENT)
    expect(decoded.slippage.buyToken).toBe(TOKEN_B)
    expect(decoded.slippage.minAmountOut).toBe(475_000_000_000_000_000n)
    expect(decoded.actions).toHaveLength(1)
    expect(selectorOf(decoded.actions[0]!)).toBe(
      SETTLER_ACTION_SELECTORS.UNISWAPV2.toLowerCase()
    )
  })

  it('multi-hop V3: produces N UNISWAPV3 actions, intermediate hop minOut=0', () => {
    const quote = baseQuote({
      path: [tokenA, tokenB, tokenC],
      routeAddresses: [TOKEN_A, TOKEN_B, TOKEN_C],
      sources: [
        { dexId: 'pancake-v3', poolAddress: POOL_AB, feeTier: 500, amountIn: 1_000_000_000_000_000_000n, amountOut: 600_000_000_000_000_000n },
        { dexId: 'pancake-v3', poolAddress: POOL_BC, feeTier: 2500, amountIn: 600_000_000_000_000_000n, amountOut: 300_000_000_000_000_000n },
      ],
      hopVersions: ['v3', 'v3'],
      amountOut: 300_000_000_000_000_000n,
    })

    const result = backend.build({
      quote,
      recipient: RECIPIENT,
      amountOutMin: 285_000_000_000_000_000n,
      useNativeInput: false,
      useNativeOutput: false,
      tokenFlow: 'allowance-holder',
      chain: makeChain(),
      fee: null,
      deadlineSeconds: 600,
    })

    const decoded = decodeOuter(result.data)
    expect(decoded.actions).toHaveLength(2)
    expect(selectorOf(decoded.actions[0]!)).toBe(SETTLER_ACTION_SELECTORS.UNISWAPV3.toLowerCase())
    expect(selectorOf(decoded.actions[1]!)).toBe(SETTLER_ACTION_SELECTORS.UNISWAPV3.toLowerCase())

    // Inner UNISWAPV3 layout: (address recipient, uint256 bps, bytes path, uint256 amountOutMin)
    const decode = (action: `0x${string}`) =>
      decodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'uint256' }],
        ('0x' + action.slice(10)) as `0x${string}`
      ) as readonly [Address, bigint, `0x${string}`, bigint]

    const [recipient0, bps0, _path0, min0] = decode(decoded.actions[0]!)
    const [recipient1, bps1, _path1, min1] = decode(decoded.actions[1]!)
    expect(recipient0).toBe(SETTLER_ADDR)
    expect(recipient1).toBe(SETTLER_ADDR)
    expect(bps0).toBe(10_000n)
    expect(bps1).toBe(10_000n)
    expect(min0).toBe(0n) // intermediate hop
    expect(min1).toBe(285_000_000_000_000_000n) // final hop carries amountOutMin
  })

  it('native input: prepends WRAP action and sets msg.value, token=0x0', () => {
    const result = backend.build({
      quote: baseQuote(),
      recipient: RECIPIENT,
      amountOutMin: 475_000_000_000_000_000n,
      useNativeInput: true,
      useNativeOutput: false,
      tokenFlow: 'allowance-holder',
      chain: makeChain(),
      fee: null,
      deadlineSeconds: 600,
    })

    expect(result.value).toBe(1_000_000_000_000_000_000n)
    const decoded = decodeOuter(result.data)
    expect(decoded.token).toBe('0x0000000000000000000000000000000000000000')
    expect(decoded.amount).toBe(0n)
    expect(decoded.actions).toHaveLength(2) // wrap + v2
    expect(selectorOf(decoded.actions[0]!)).toBe(SETTLER_ACTION_SELECTORS.BASIC.toLowerCase())
    expect(selectorOf(decoded.actions[1]!)).toBe(SETTLER_ACTION_SELECTORS.UNISWAPV2.toLowerCase())
  })

  it('native output: appends UNWRAP action and uses ETH sentinel as buyToken', () => {
    const result = backend.build({
      quote: baseQuote(),
      recipient: RECIPIENT,
      amountOutMin: 475_000_000_000_000_000n,
      useNativeInput: false,
      useNativeOutput: true,
      tokenFlow: 'allowance-holder',
      chain: makeChain(),
      fee: null,
      deadlineSeconds: 600,
    })

    const decoded = decodeOuter(result.data)
    expect(decoded.slippage.buyToken).toBe(SETTLER_ETH_ADDRESS)
    expect(decoded.actions).toHaveLength(2) // v2 + unwrap
    expect(selectorOf(decoded.actions[0]!)).toBe(SETTLER_ACTION_SELECTORS.UNISWAPV2.toLowerCase())
    expect(selectorOf(decoded.actions[1]!)).toBe(SETTLER_ACTION_SELECTORS.BASIC.toLowerCase())
  })

  it('fee config: appends POSITIVE_SLIPPAGE with expectedAmount = quote * (1 - fee/10000)', () => {
    const result = backend.build({
      quote: baseQuote(),
      recipient: RECIPIENT,
      amountOutMin: 475_000_000_000_000_000n,
      useNativeInput: false,
      useNativeOutput: false,
      tokenFlow: 'allowance-holder',
      chain: makeChain(),
      fee: { bps: 30, recipient: FEE_RECIPIENT },
      deadlineSeconds: 600,
    })

    const decoded = decodeOuter(result.data)
    expect(decoded.actions).toHaveLength(2) // v2 + positive-slippage
    expect(selectorOf(decoded.actions[1]!)).toBe(SETTLER_ACTION_SELECTORS.POSITIVE_SLIPPAGE.toLowerCase())

    // POSITIVE_SLIPPAGE layout: (recipient, sellToken, expectedAmount, amountOutMin)
    const [feeRecipient, sellToken, expectedAmount, amountOutMin] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
      ('0x' + decoded.actions[1]!.slice(10)) as `0x${string}`
    ) as readonly [Address, Address, bigint, bigint]

    expect(feeRecipient).toBe(FEE_RECIPIENT)
    expect(sellToken).toBe(TOKEN_B)
    // 500_000_000_000_000_000 * (10000 - 30) / 10000 = 498_500_000_000_000_000
    expect(expectedAmount).toBe(498_500_000_000_000_000n)
    expect(amountOutMin).toBe(475_000_000_000_000_000n)
  })

  it('split routes: encodes per-leg actions with scaled bps', () => {
    // 30/40/30 split: leg ratios produce bps of 3000, 5714, 10000 respectively
    // (consumeBps math: remaining=10000 -> 3000; remaining=7000 -> floor(4000*10000/7000)=5714;
    // last leg -> 10000).
    const legQuote = (poolAddress: Address): PriceQuote => ({
      ...baseQuote(),
      sources: [
        { dexId: 'pancake-v2', poolAddress, amountIn: 1n, amountOut: 1n },
      ],
    })
    const splitQuote: PriceQuote = {
      ...baseQuote(),
      isSplit: true,
      splits: [
        { quote: legQuote(POOL_AB), ratioBps: 3_000 },
        { quote: legQuote(POOL_BC), ratioBps: 4_000 },
        { quote: legQuote(POOL_AB), ratioBps: 3_000 },
      ],
    }

    const result = backend.build({
      quote: splitQuote,
      recipient: RECIPIENT,
      amountOutMin: 475_000_000_000_000_000n,
      useNativeInput: false,
      useNativeOutput: false,
      tokenFlow: 'allowance-holder',
      chain: makeChain(),
      fee: null,
      deadlineSeconds: 600,
    })

    const decoded = decodeOuter(result.data)
    expect(decoded.actions).toHaveLength(3) // one hop per leg

    const decodeV2 = (action: `0x${string}`) =>
      decodeAbiParameters(
        [
          { type: 'address' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint24' },
          { type: 'uint256' },
        ],
        ('0x' + action.slice(10)) as `0x${string}`
      ) as readonly [Address, Address, bigint, Address, number, bigint]

    const [, , bps0, , ,] = decodeV2(decoded.actions[0]!)
    const [, , bps1, , ,] = decodeV2(decoded.actions[1]!)
    const [, , bps2, , ,] = decodeV2(decoded.actions[2]!)
    expect(bps0).toBe(3_000n)
    expect(bps1).toBe(5_714n)
    expect(bps2).toBe(10_000n)
  })

  it('rejects splits with mismatched ratios', () => {
    const legQuote: PriceQuote = {
      ...baseQuote(),
      sources: [{ dexId: 'pancake-v2', poolAddress: POOL_AB, amountIn: 1n, amountOut: 1n }],
    }
    const badSplit: PriceQuote = {
      ...baseQuote(),
      isSplit: true,
      splits: [
        { quote: legQuote, ratioBps: 5_000 },
        { quote: legQuote, ratioBps: 4_000 }, // sums to 9000, not 10000
      ],
    }
    expect(() =>
      backend.build({
        quote: badSplit,
        recipient: RECIPIENT,
        amountOutMin: 475_000_000_000_000_000n,
        useNativeInput: false,
        useNativeOutput: false,
        tokenFlow: 'allowance-holder',
        chain: makeChain(),
        fee: null,
        deadlineSeconds: 600,
      })
    ).toThrow(/ratios must sum to 10000/)
  })

  it('rejects Permit2 mode with NOT_IMPLEMENTED', () => {
    expect(() =>
      backend.build({
        quote: baseQuote(),
        recipient: RECIPIENT,
        amountOutMin: 475_000_000_000_000_000n,
        useNativeInput: false,
        useNativeOutput: false,
        tokenFlow: 'permit2',
        chain: makeChain(),
        fee: null,
        deadlineSeconds: 600,
      })
    ).toThrow(/Permit2 token-flow/)
  })

  it('rejects when Settler address is not configured for the chain', () => {
    const chain = makeChain()
    const chainWithoutSettler: ChainConfig = {
      ...chain,
      settler: { ...chain.settler!, settler: null },
    }
    expect(() =>
      backend.build({
        quote: baseQuote(),
        recipient: RECIPIENT,
        amountOutMin: 475_000_000_000_000_000n,
        useNativeInput: false,
        useNativeOutput: false,
        tokenFlow: 'allowance-holder',
        chain: chainWithoutSettler,
        fee: null,
        deadlineSeconds: 600,
      })
    ).toThrow(/Settler address not configured/)
  })
})
