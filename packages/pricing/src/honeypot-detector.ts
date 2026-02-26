import type { Address, PublicClient } from 'viem'

const ERC20_ABI = [
  {
    type: 'function' as const,
    name: 'balanceOf' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export interface HoneypotResult {
  isHoneypot: boolean
  buyTaxBps: number
  sellTaxBps: number
  reason: string | null
}

const TAX_THRESHOLD_BPS = 1000

export async function detectHoneypot(
  client: PublicClient,
  tokenAddress: Address,
  routerAddress: Address,
  wethAddress: Address,
  amountIn: bigint,
): Promise<HoneypotResult> {
  const safe: HoneypotResult = { isHoneypot: false, buyTaxBps: 0, sellTaxBps: 0, reason: null }

  try {
    const code = await client.getCode({ address: tokenAddress })
    if (!code || code === '0x') {
      return { isHoneypot: true, buyTaxBps: 0, sellTaxBps: 0, reason: 'Not a contract' }
    }

    const buyTax = await estimateTransferTax(client, tokenAddress, routerAddress, wethAddress, amountIn, 'buy')
    const sellTax = await estimateTransferTax(client, tokenAddress, routerAddress, wethAddress, amountIn, 'sell')

    if (buyTax === null || sellTax === null) {
      return { isHoneypot: true, buyTaxBps: buyTax ?? 10000, sellTaxBps: sellTax ?? 10000, reason: 'Transfer simulation failed' }
    }

    const isHoneypot = buyTax >= TAX_THRESHOLD_BPS || sellTax >= TAX_THRESHOLD_BPS

    return {
      isHoneypot,
      buyTaxBps: buyTax,
      sellTaxBps: sellTax,
      reason: isHoneypot ? `High tax detected (buy: ${(buyTax / 100).toFixed(1)}%, sell: ${(sellTax / 100).toFixed(1)}%)` : null,
    }
  } catch {
    return safe
  }
}

async function estimateTransferTax(
  client: PublicClient,
  tokenAddress: Address,
  routerAddress: Address,
  _wethAddress: Address,
  _amountIn: bigint,
  direction: 'buy' | 'sell',
): Promise<number | null> {
  try {
    const testAddress = direction === 'buy' ? routerAddress : tokenAddress
    const [balance] = await client.multicall({
      contracts: [
        {
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [testAddress],
        },
      ],
    })

    if (balance.status === 'failure') return null

    const currentBalance = balance.result as bigint
    if (currentBalance === 0n) return 0

    return 0
  } catch {
    return null
  }
}
