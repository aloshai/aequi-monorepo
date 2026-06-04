import { useMemo } from 'react'
import { useBalance, useReadContract } from 'wagmi'
import { useSwapStore } from '../store/use-swap-store'
import { CHAIN_BY_KEY } from '../lib/wagmi'
import type { ChainKey } from '../types/api'

const NATIVE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const erc20Abi = [{
  name: 'balanceOf' as const,
  type: 'function' as const,
  stateMutability: 'view' as const,
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: 'balance', type: 'uint256' }],
}]

type SupportedChainId =
  | typeof CHAIN_BY_KEY.ethereum.id
  | typeof CHAIN_BY_KEY.bsc.id
  | typeof CHAIN_BY_KEY.incentiv.id
  | typeof CHAIN_BY_KEY.ink.id

const CHAIN_ID_BY_KEY: Record<ChainKey, SupportedChainId> = {
  ethereum: CHAIN_BY_KEY.ethereum.id,
  bsc: CHAIN_BY_KEY.bsc.id,
  incentiv: CHAIN_BY_KEY.incentiv.id,
  ink: CHAIN_BY_KEY.ink.id,
}

export const formatBigIntAmount = (value: bigint, decimals: number, precision = 6): string => {
  if (value === 0n) return '0'
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const remainder = value % divisor
  if (remainder === 0n) return whole.toString()
  const fracStr = remainder.toString().padStart(decimals, '0').slice(0, precision)
  const trimmed = fracStr.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole.toString()
}

export function useTokenBalances(address: `0x${string}` | undefined) {
  const { tokenA, tokenB, selectedChain } = useSwapStore()
  const selectedChainId = CHAIN_ID_BY_KEY[selectedChain]

  const isNativeA = tokenA?.address.toLowerCase() === NATIVE_SENTINEL
  const isNativeB = tokenB?.address.toLowerCase() === NATIVE_SENTINEL

  const { data: nativeBalance } = useBalance({ address, chainId: selectedChainId })

  const { data: tokenABalance } = useReadContract({
    address: tokenA && !isNativeA ? tokenA.address as `0x${string}` : undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: selectedChainId,
    query: { enabled: !!address && !!tokenA && !isNativeA },
  })

  const { data: tokenBBalance } = useReadContract({
    address: tokenB && !isNativeB ? tokenB.address as `0x${string}` : undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: selectedChainId,
    query: { enabled: !!address && !!tokenB && !isNativeB },
  })

  const balanceA = useMemo(() => {
    if (!tokenA) return 0n
    if (isNativeA) return nativeBalance?.value ?? 0n
    return (tokenABalance as unknown as bigint) ?? 0n
  }, [tokenA, isNativeA, nativeBalance, tokenABalance])

  const balanceB = useMemo(() => {
    if (!tokenB) return 0n
    if (isNativeB) return nativeBalance?.value ?? 0n
    return (tokenBBalance as unknown as bigint) ?? 0n
  }, [tokenB, isNativeB, nativeBalance, tokenBBalance])

  const fmtA = useMemo(() => tokenA ? formatBigIntAmount(balanceA, tokenA.decimals) : '0', [balanceA, tokenA])
  const fmtB = useMemo(() => tokenB ? formatBigIntAmount(balanceB, tokenB.decimals) : '0', [balanceB, tokenB])

  return { balanceA, balanceB, fmtA, fmtB, isNativeA, isNativeB }
}
