import { useCallback } from 'react'
import { useSendTransaction, useSignTypedData } from 'wagmi'
import { waitForTransactionReceipt, estimateFeesPerGas } from 'wagmi/actions'
import { encodeFunctionData } from 'viem'
import type { Hex } from 'viem'
import { SETTLER_META_TXN_ABI } from '@aequi/core'
import { useSwapStore } from '../store/use-swap-store'
import { useSettingsStore } from '../store/use-settings-store'
import { useUiStore } from '../store/use-ui-store'
import {
  fetchAllowances,
  requestApproveCalldata,
  requestSwapTransaction,
} from '../services/aequi-api'
import { resolveApiErrorMessage, resolveApiErrorPayload } from '../lib/http'
import { parseSwapError } from '../utils/swap-errors'
import { wagmiConfig, CHAIN_BY_KEY } from '../lib/wagmi'
import type { ChainKey, AllowanceResponse, Permit2PayloadResponse } from '../types/api'

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

/** Fetch current fee params with a 30% buffer on maxFeePerGas for inclusion safety. */
async function getFeeParams(chainId: SupportedChainId) {
  try {
    const fees = await estimateFeesPerGas(wagmiConfig, { chainId })
    if (fees.maxFeePerGas && fees.maxPriorityFeePerGas) {
      return {
        maxFeePerGas: (fees.maxFeePerGas * 130n) / 100n,
        maxPriorityFeePerGas: (fees.maxPriorityFeePerGas * 120n) / 100n,
      }
    }
  } catch {
    // Fall through — let the wallet decide
  }
  return {}
}

export function useSwapExecution(
  address: `0x${string}` | undefined,
  isConnected: boolean,
  chainMismatch: boolean,
) {
  const { sendTransactionAsync } = useSendTransaction()
  const { signTypedDataAsync } = useSignTypedData()

  const refreshAllowance = useCallback(
    async (token: string, spender: string, options?: { silent?: boolean }): Promise<AllowanceResponse | null> => {
      if (!address) return null
      const { selectedChain } = useSwapStore.getState()
      try {
        const data = await fetchAllowances({ chain: selectedChain, owner: address, spender, tokens: [token] })
        useSwapStore.getState().setAllowanceState(data)
        return data
      } catch (e) {
        if (!options?.silent) resolveApiErrorPayload(e)
        return null
      }
    },
    [address],
  )

  const ensureAllowanceSynced = useCallback(async (): Promise<boolean> => {
    const { preparedSwap } = useSwapStore.getState()
    if (!preparedSwap?.tokens.length) return false

    const tokenAddr = preparedSwap.tokens[0]!.address
    const spender = preparedSwap.transaction.spender
    let required = 0n
    try { required = BigInt(preparedSwap.transaction.amountIn) } catch { required = 0n }

    for (let i = 0; i < 4; i++) {
      const resp = await refreshAllowance(tokenAddr, spender, { silent: i > 0 })
      if (resp) {
        const entry = resp.allowances.find(a => a.token.toLowerCase() === tokenAddr.toLowerCase())
        if (entry) {
          try {
            if (BigInt(entry.allowance) >= required) return true
          } catch {
            // Ignore malformed allowance strings and continue retry loop.
          }
        }
      }
      if (i < 3) await new Promise(r => setTimeout(r, 1500))
    }
    return false
  }, [refreshAllowance])

  const prepareSwap = useCallback(async () => {
    const store = useSwapStore.getState()
    const settings = useSettingsStore.getState()

    if (!store.quoteResult) {
      store.setSwapExecutionError('Request a quote first')
      return
    }
    if (store.quoteResult.expiresAt && Date.now() / 1000 > store.quoteResult.expiresAt) {
      store.setSwapExecutionError('Quote has expired — please refresh')
      return
    }
    if (!address || !isConnected) {
      store.setSwapExecutionError('Connect wallet')
      return
    }
    if (chainMismatch) {
      store.setSwapExecutionError('Switch to the correct network')
      return
    }

    const tA = store.tokenA?.address
    const tB = store.tokenB?.address
    if (!tA || !tB) return

    store.setPrepareLoading(true)
    store.setPrepareError(null)

    try {
      const swapData = await requestSwapTransaction({
        chain: store.selectedChain,
        tokenA: tA,
        tokenB: tB,
        amount: store.amount.trim(),
        slippageBps: settings.slippageBps === 'auto'
          ? undefined
          : (settings.slippageBps.trim() ? Number(settings.slippageBps) : undefined),
        version: settings.version,
        recipient: address,
        deadlineSeconds: settings.deadlineSeconds.trim()
          ? Number(settings.deadlineSeconds)
          : undefined,
        forceMultiHop: store.forceMultiHop,
        quoteId: store.quoteResult.quoteId,
        tokenFlow: settings.tokenFlow,
      })

      store.setPreparedSwap(swapData)
      store.setPrepareLoading(false)
      useUiStore.getState().setSwapConfirmModalOpen(true)
    } catch (e) {
      store.setPrepareError(resolveApiErrorMessage(e))
      store.setPrepareLoading(false)
    }
  }, [address, isConnected, chainMismatch])

  const confirmSwap = useCallback(async () => {
    const store = useSwapStore.getState()
    const settings = useSettingsStore.getState()
    const { preparedSwap, selectedChain } = store
    if (!preparedSwap) return

    const selectedChainId = CHAIN_ID_BY_KEY[selectedChain]
    store.setApprovalError(null)
    store.setSwapExecutionError(null)

    try {
      const inputToken = preparedSwap.tokens[0]?.address
      if (!inputToken) throw new Error('Input token metadata unavailable')

      const allowanceData = await refreshAllowance(inputToken, preparedSwap.transaction.spender, { silent: true })
      let needsApproval = true

      if (allowanceData) {
        const entry = allowanceData.allowances.find(
          a => a.token.toLowerCase() === inputToken.toLowerCase(),
        )
        if (entry) {
          try {
            if (BigInt(entry.allowance) >= BigInt(preparedSwap.transaction.amountIn)) {
              needsApproval = false
            }
          } catch {
            // Ignore malformed allowance values and fall back to approval flow.
          }
        }
      }

      if (needsApproval) {
        const useInfinite = settings.approvalMode === 'infinite'
        store.setApprovalLoading(useInfinite ? 'infinite' : 'exact')

        const approvalData = await requestApproveCalldata({
          chain: selectedChain,
          token: inputToken,
          spender: preparedSwap.transaction.spender,
          ...(useInfinite ? { infinite: true } : { amount: preparedSwap.transaction.amountIn }),
        })

        const txTarget = approvalData.transaction?.to
        const txData = approvalData.transaction?.data
        if (!txTarget || !txData) throw new Error('Approval payload missing')

        const feeParams = await getFeeParams(selectedChainId)
        const aTx = await sendTransactionAsync({
          chainId: selectedChainId,
          to: txTarget as `0x${string}`,
          data: txData as `0x${string}`,
          value: BigInt(approvalData.transaction?.value ?? '0'),
          ...feeParams,
        })

        store.setApprovalHash(aTx)
        await waitForTransactionReceipt(wagmiConfig, { chainId: selectedChainId, hash: aTx })
        store.setApprovalHash(null)
        store.setApprovalLoading(null)
        await ensureAllowanceSynced()
      }

      store.setSwapExecutionLoading(true)
      if (!preparedSwap.transaction.call) throw new Error('Missing transaction payload')

      // Use server-provided gas estimate, or fall back to a generous
      // multi-hop V2/V3 swap estimate so wallets don't reject the tx.
      const gas: bigint = preparedSwap.transaction.estimatedGas
        ? BigInt(preparedSwap.transaction.estimatedGas)
        : 400_000n

      const swapFeeParams = await getFeeParams(selectedChainId)

      // Permit2 mode: sign EIP-712 typed data and re-encode executeMetaTxn
      // with the wallet signature filled in. AllowanceHolder mode uses the
      // server-supplied calldata verbatim.
      let txTo = preparedSwap.transaction.call.to as `0x${string}`
      let txData = preparedSwap.transaction.call.data as `0x${string}`
      const txValue = BigInt(preparedSwap.transaction.call.value ?? '0')

      if (preparedSwap.transaction.kind === 'settler-permit2') {
        const permit2: Permit2PayloadResponse | null = preparedSwap.transaction.permit2
        if (!permit2) throw new Error('Permit2 payload missing for settler-permit2 swap')

        // Re-hydrate string-encoded bigints back to bigints before signing.
        // The wallet expects the same JS types it would in a native dapp.
        const typedDataForSigning = {
          domain: permit2.typedData.domain,
          types: permit2.typedData.types,
          primaryType: permit2.typedData.primaryType,
          message: {
            permitted: {
              token: permit2.typedData.message.permitted.token as `0x${string}`,
              amount: BigInt(permit2.typedData.message.permitted.amount),
            },
            spender: permit2.typedData.message.spender as `0x${string}`,
            nonce: BigInt(permit2.typedData.message.nonce),
            deadline: BigInt(permit2.typedData.message.deadline),
            witness: {
              recipient: permit2.typedData.message.witness.recipient as `0x${string}`,
              buyToken: permit2.typedData.message.witness.buyToken as `0x${string}`,
              minAmountOut: BigInt(permit2.typedData.message.witness.minAmountOut),
              actions: permit2.typedData.message.witness.actions as Hex[],
            },
          },
        } as const

        const sig = await signTypedDataAsync(typedDataForSigning as never)

        // Re-encode executeMetaTxn with the actual signature in place of the
        // 0x placeholder. We use the SETTLER_META_TXN_ABI from @aequi/core so
        // both sides agree on the function shape.
        txData = encodeFunctionData({
          abi: SETTLER_META_TXN_ABI,
          functionName: 'executeMetaTxn',
          args: [
            {
              recipient: permit2.slippage.recipient as `0x${string}`,
              buyToken: permit2.slippage.buyToken as `0x${string}`,
              minAmountOut: BigInt(permit2.slippage.minAmountOut),
            },
            permit2.actions as Hex[],
            permit2.zid as `0x${string}`,
            permit2.msgSender as `0x${string}`,
            sig,
          ],
        })
        txTo = preparedSwap.transaction.call.to as `0x${string}`
      }

      const sTx = await sendTransactionAsync({
        chainId: selectedChainId,
        to: txTo,
        data: txData,
        value: txValue,
        gas,
        ...swapFeeParams,
      })

      store.setSwapHash(sTx)

      const tInSym = preparedSwap.tokens[0]?.symbol ?? '?'
      const tOutSym = preparedSwap.tokens[preparedSwap.tokens.length - 1]?.symbol ?? '?'

      store.addToHistory({
        hash: sTx,
        chain: selectedChain,
        tokenInSymbol: tInSym,
        tokenOutSymbol: tOutSym,
        amountIn: preparedSwap.amountInFormatted,
        amountOut: preparedSwap.amountOutFormatted,
        timestamp: Date.now(),
        status: 'pending',
      })

      await waitForTransactionReceipt(wagmiConfig, { chainId: selectedChainId, hash: sTx })
      store.updateHistoryStatus(sTx, 'confirmed')
      store.setSwapHash(null)
      store.setQuoteResult(null)
      store.setAmount('')
      useUiStore.getState().setSwapConfirmModalOpen(false)
      store.setPreparedSwap(null)
    } catch (e) {
      const currentStore = useSwapStore.getState()
      if (currentStore.approvalLoading) {
        store.setApprovalError(resolveApiErrorMessage(e))
      } else {
        const msg = parseSwapError(e)
        store.setSwapExecutionError(msg)
        if (currentStore.swapHash) {
          store.updateHistoryStatus(currentStore.swapHash, 'failed')
        }
      }
      store.setApprovalHash(null)
      store.setSwapHash(null)
    } finally {
      store.setApprovalLoading(null)
      store.setSwapExecutionLoading(false)
    }
  }, [refreshAllowance, sendTransactionAsync, signTypedDataAsync, ensureAllowanceSynced])

  return { prepareSwap, confirmSwap }
}
