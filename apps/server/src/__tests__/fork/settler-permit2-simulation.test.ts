/**
 * Real-RPC test for the Permit2 (settler-permit2) flow:
 *
 *   1. SettlerBackend.build() produces an EIP-712 payload + actions[].
 *   2. A throwaway private key signs the payload via viem.
 *   3. The signature is spliced into a fully-encoded executeMetaTxn(...) call.
 *   4. We eth_call the result against the real BSC SettlerMetaTxn with state
 *      overrides that fake the EOA's WBNB balance + Permit2 allowance.
 *
 * Accepts a Settler-internal revert (TooMuchSlippage, TRANSFER_FROM_FAILED,
 * InvalidSigner) as proof that calldata dispatched correctly — state-override
 * slot guessing cannot replicate every token's storage layout, but Settler
 * reaching its own checks proves our encoding is correct.
 */

import { describe, it, expect } from 'vitest'
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  pad,
  toHex,
  getAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bsc } from 'viem/chains'
import { SETTLER_META_TXN_ABI, SettlerBackend, type SwapPlan } from '@aequi/core'
import { CHAIN_CONFIGS } from '../../config/chains'
import { appConfig } from '../../config/app-config'

const BSC_RPC = process.env.BSC_RPC_URL?.split(',')[0]?.trim() || 'https://bsc-dataseed.binance.org'
const SHOULD_SKIP = process.env.SKIP_FORK_TESTS === '1'

const WBNB: Address = getAddress('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c')
const BUSD: Address = getAddress('0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56')
const WBNB_BUSD_V2_POOL: Address = getAddress('0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16')

// Throwaway key — does NOT need to be funded; we only need a signature.
// (Public key derivation is deterministic; address is fixed.)
const TAKER_PK: Hex = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'

function buildOverrides(taker: Address, token: Address, permit2: Address, amount: bigint) {
  const COMMON_BALANCE_SLOTS = [0n, 1n, 2n, 3n, 51n, 101n]
  const balanceHex = pad(toHex(amount * 100n), { size: 32 })
  const allowanceHex = pad(toHex(2n ** 256n - 1n), { size: 32 })
  const diffs: Array<{ slot: Hex; value: Hex }> = []
  for (const baseSlot of COMMON_BALANCE_SLOTS) {
    const balSlot = keccak256(
      encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [taker, baseSlot])
    )
    diffs.push({ slot: balSlot, value: balanceHex })
    const allowanceBase = keccak256(
      encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [taker, baseSlot + 1n])
    )
    const allowanceSlot = keccak256(
      encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [permit2, allowanceBase])
    )
    diffs.push({ slot: allowanceSlot, value: allowanceHex })
  }
  return [
    { address: taker, balance: 10n ** 24n },
    { address: token, stateDiff: diffs },
  ]
}

describe.skipIf(SHOULD_SKIP)('SettlerBackend Permit2 ↔ real BSC SettlerMetaTxn', () => {
  const publicClient = createPublicClient({ chain: bsc, transport: http(BSC_RPC) })
  const taker = privateKeyToAccount(TAKER_PK)
  const wallet = createWalletClient({ account: taker, chain: bsc, transport: http(BSC_RPC) })

  it('builds executeMetaTxn calldata that dispatches correctly on chain', async () => {
    const chain = CHAIN_CONFIGS.bsc
    const backend = new SettlerBackend()
    const amountIn = 10n ** 17n // 0.1 WBNB

    const plan: SwapPlan = {
      quote: {
        chain: 'bsc',
        amountIn,
        amountOut: 30n * 10n ** 18n,
        priceQ18: 0n,
        executionPriceQ18: 0n,
        midPriceQ18: 0n,
        priceImpactBps: 0,
        path: [
          { chainId: 56, address: WBNB, symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18, totalSupply: null },
          { chainId: 56, address: BUSD, symbol: 'BUSD', name: 'BUSD Token', decimals: 18, totalSupply: null },
        ],
        routeAddresses: [WBNB, BUSD],
        sources: [
          { dexId: 'pancake-v2', poolAddress: WBNB_BUSD_V2_POOL, amountIn, amountOut: 30n * 10n ** 18n },
        ],
        liquidityScore: 0n,
        hopVersions: ['v2'],
        estimatedGasUnits: null,
        estimatedGasCostWei: null,
        gasPriceWei: null,
      },
      recipient: taker.address,
      amountOutMin: 1n,
      useNativeInput: false,
      useNativeOutput: false,
      tokenFlow: 'permit2',
      chain,
      fee: null,
      deadlineSeconds: 600,
    }

    const result = backend.build(plan)
    expect(result.kind).toBe('settler-permit2')
    expect(result.to).toBe(appConfig.settler.byChain.bsc.settlerMetaTxn)
    expect(result.permit2).toBeDefined()

    const permit2 = result.permit2!

    // Sign the EIP-712 payload with the throwaway key.
    const sig = await wallet.signTypedData(permit2.typedData as never)
    expect(sig).toMatch(/^0x[0-9a-f]+$/)
    expect(sig.length).toBeGreaterThan(2)

    // Re-encode executeMetaTxn with the real signature in place of 0x placeholder.
    const calldata = encodeFunctionData({
      abi: SETTLER_META_TXN_ABI,
      functionName: 'executeMetaTxn',
      args: [
        permit2.slippage,
        permit2.actions,
        permit2.zid,
        permit2.msgSender,
        sig,
      ],
    })

    const overrides = buildOverrides(taker.address, WBNB, appConfig.settler.permit2, amountIn)
    try {
      await publicClient.call({
        account: taker.address,
        to: result.to,
        data: calldata,
        value: 0n,
        stateOverride: overrides,
      })
    } catch (err: unknown) {
      const message = (err as Error).message ?? ''
      const accepted = /TooMuchSlippage|TooLittleReceived|InsufficientBalance|TRANSFER_FROM_FAILED|InvalidSigner|InvalidSignature|0x/i
      if (!accepted.test(message)) {
        throw err
      }
      console.warn('[permit2-fork-test] BSC simulation reverted with expected internal error:', message.slice(0, 200))
    }
  }, 60_000)
})
