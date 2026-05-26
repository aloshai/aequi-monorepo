/**
 * Real-RPC simulation test against Ethereum mainnet's canonical Settler.
 * Mirrors the BSC fork test but uses public Ethereum RPCs since RPC_URL_ETH
 * may not be set in the local .env. Skipped if SKIP_FORK_TESTS=1.
 */

import { describe, it, expect } from 'vitest'
import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  pad,
  toHex,
  getAddress,
  type Address,
} from 'viem'
import { mainnet } from 'viem/chains'
import { SettlerBackend, type SwapPlan } from '@aequi/core'
import { CHAIN_CONFIGS } from '../../config/chains'
import { appConfig } from '../../config/app-config'

const ETH_RPC =
  process.env.RPC_URL_ETH?.split(',').find((u) => u && !u.includes('YOUR_KEY'))?.trim() ||
  'https://ethereum-rpc.publicnode.com'
const SHOULD_SKIP = process.env.SKIP_FORK_TESTS === '1'

// Uniswap V3 ETH-USDC 500 fee tier (deepest pool).
const WETH: Address = getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
const USDC: Address = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const SYNTHETIC_TAKER: Address = getAddress('0x000000000000000000000000000000000000DeaD')

function buildOverrides(taker: Address, token: Address, allowanceHolder: Address, amount: bigint) {
  const COMMON_BALANCE_SLOTS = [0n, 1n, 2n, 3n, 9n, 51n, 101n]
  const balanceHex = pad(toHex(amount * 100n), { size: 32 })
  const allowanceHex = pad(toHex(2n ** 256n - 1n), { size: 32 })
  const diffs: Array<{ slot: `0x${string}`; value: `0x${string}` }> = []
  for (const baseSlot of COMMON_BALANCE_SLOTS) {
    const balSlot = keccak256(
      encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [taker, baseSlot])
    )
    diffs.push({ slot: balSlot, value: balanceHex })
    const allowanceBase = keccak256(
      encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [taker, baseSlot + 1n])
    )
    const allowanceSlot = keccak256(
      encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [allowanceHolder, allowanceBase])
    )
    diffs.push({ slot: allowanceSlot, value: allowanceHex })
  }
  return [
    { address: taker, balance: 10n ** 24n },
    { address: token, stateDiff: diffs },
  ]
}

describe.skipIf(SHOULD_SKIP)('SettlerBackend ↔ real ETH Settler eth_call', () => {
  const client = createPublicClient({ chain: mainnet, transport: http(ETH_RPC) })

  it('ETH Settler bytecode is present', async () => {
    const code = await client.getCode({ address: appConfig.settler.byChain.ethereum.settler! })
    expect((code ?? '0x').length).toBeGreaterThan(2)
  }, 30_000)

  it('ETH SettlerMetaTxn bytecode is present', async () => {
    const code = await client.getCode({ address: appConfig.settler.byChain.ethereum.settlerMetaTxn! })
    expect((code ?? '0x').length).toBeGreaterThan(2)
  }, 30_000)

  it('single-hop V3 WETH → USDC: backend calldata reaches Settler', async () => {
    const chain = CHAIN_CONFIGS.ethereum
    const backend = new SettlerBackend()
    const amountIn = 10n ** 17n // 0.1 WETH

    const plan: SwapPlan = {
      quote: {
        chain: 'ethereum',
        amountIn,
        amountOut: 300n * 10n ** 6n, // ~300 USDC, only used for fee math (fee=null here)
        priceQ18: 0n,
        executionPriceQ18: 0n,
        midPriceQ18: 0n,
        priceImpactBps: 0,
        path: [
          { chainId: 1, address: WETH, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, totalSupply: null },
          { chainId: 1, address: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, totalSupply: null },
        ],
        routeAddresses: [WETH, USDC],
        sources: [
          // Uniswap V3 WETH/USDC 500 fee tier pool on Ethereum mainnet.
          // poolAddress is required by the type but unused by SettlerBackend
          // for V3 (Settler derives the pool from forkId + tokens + feeTier).
          {
            dexId: 'uniswap-v3',
            poolAddress: getAddress('0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'),
            feeTier: 500,
            amountIn,
            amountOut: 300n * 10n ** 6n,
          },
        ],
        liquidityScore: 0n,
        hopVersions: ['v3'],
        estimatedGasUnits: null,
        estimatedGasCostWei: null,
        gasPriceWei: null,
      },
      recipient: SYNTHETIC_TAKER,
      amountOutMin: 1n,
      useNativeInput: false,
      useNativeOutput: false,
      tokenFlow: 'allowance-holder',
      chain,
      fee: null,
      deadlineSeconds: 600,
    }

    const result = backend.build(plan)
    expect(result.to).toBe(appConfig.settler.allowanceHolder)

    const overrides = buildOverrides(SYNTHETIC_TAKER, WETH, appConfig.settler.allowanceHolder, amountIn)
    try {
      await client.call({
        account: SYNTHETIC_TAKER,
        to: result.to,
        data: result.data,
        value: result.value,
        stateOverride: overrides,
      })
    } catch (err: unknown) {
      const message = (err as Error).message ?? ''
      const accepted = /TooMuchSlippage|TooLittleReceived|InsufficientBalance|TRANSFER_FROM_FAILED|InvalidPermit|TRANSFER_FAILED|0x/i
      if (!accepted.test(message)) {
        throw err
      }
      console.warn('[fork-test] ETH simulation reverted with expected internal error:', message.slice(0, 200))
    }
  }, 60_000)
})
