import { describe, it, expect, vi } from 'vitest'
import { detectHoneypot, type HoneypotResult } from '../honeypot-detector'
import type { Address, PublicClient } from 'viem'

const TOKEN = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as Address
const ROUTER = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as Address
const WETH = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' as Address

const makeClient = (overrides: Partial<PublicClient> = {}): PublicClient =>
  ({
    getCode: vi.fn().mockResolvedValue('0x6060604052'),
    multicall: vi.fn().mockResolvedValue([{ status: 'success', result: 1000n }]),
    ...overrides,
  }) as unknown as PublicClient

describe('detectHoneypot', () => {
  it('returns isHoneypot=true when address has no code', async () => {
    const client = makeClient({ getCode: vi.fn().mockResolvedValue('0x') })

    const result = await detectHoneypot(client, TOKEN, ROUTER, WETH, 1000n)
    expect(result.isHoneypot).toBe(true)
    expect(result.reason).toBe('Not a contract')
  })

  it('returns safe result for valid contracts', async () => {
    const client = makeClient()

    const result = await detectHoneypot(client, TOKEN, ROUTER, WETH, 1000n)
    expect(result.isHoneypot).toBe(false)
    expect(result.reason).toBeNull()
  })

  it('returns safe result when getCode throws', async () => {
    const client = makeClient({ getCode: vi.fn().mockRejectedValue(new Error('RPC error')) })

    const result = await detectHoneypot(client, TOKEN, ROUTER, WETH, 1000n)
    expect(result.isHoneypot).toBe(false)
    expect(result.reason).toBeNull()
  })

  it('returns correct structure', async () => {
    const client = makeClient()

    const result: HoneypotResult = await detectHoneypot(client, TOKEN, ROUTER, WETH, 1000n)
    expect(result).toHaveProperty('isHoneypot')
    expect(result).toHaveProperty('buyTaxBps')
    expect(result).toHaveProperty('sellTaxBps')
    expect(result).toHaveProperty('reason')
    expect(typeof result.buyTaxBps).toBe('number')
    expect(typeof result.sellTaxBps).toBe('number')
  })
})
