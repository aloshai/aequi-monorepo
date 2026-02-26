import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChainKey, QuoteResponse, SwapResponse, AllowanceResponse } from '../types/api'
import type { Token } from '../services/token-manager'
import type { SwapHistoryEntry } from '../services/swap-history'

interface SwapState {
  selectedChain: ChainKey
  tokenA: Token | null
  tokenB: Token | null
  amount: string
  forceMultiHop: boolean

  quoteResult: QuoteResponse | null
  quoteError: string | null
  quoteLoading: boolean
  quoteCountdown: number

  allowanceState: AllowanceResponse | null
  preparedSwap: SwapResponse | null
  prepareLoading: boolean
  prepareError: string | null
  approvalLoading: 'exact' | 'infinite' | null
  approvalError: string | null
  approvalHash: string | null
  swapExecutionLoading: boolean
  swapExecutionError: string | null
  swapHash: string | null
  swapConfirmModalOpen: boolean

  swapHistory: SwapHistoryEntry[]

  walletError: string | null
  connectBusy: boolean
  disconnectBusy: boolean
  switchBusy: boolean

  setSelectedChain: (chain: ChainKey) => void
  setTokenA: (token: Token | null) => void
  setTokenB: (token: Token | null) => void
  setAmount: (amount: string) => void
  setForceMultiHop: (v: boolean) => void
  swapTokens: () => void

  setQuoteResult: (result: QuoteResponse | null) => void
  setQuoteError: (error: string | null) => void
  setQuoteLoading: (loading: boolean) => void
  setQuoteCountdown: (seconds: number) => void

  setAllowanceState: (state: AllowanceResponse | null) => void
  setPreparedSwap: (swap: SwapResponse | null) => void
  setPrepareLoading: (loading: boolean) => void
  setPrepareError: (error: string | null) => void
  setApprovalLoading: (loading: 'exact' | 'infinite' | null) => void
  setApprovalError: (error: string | null) => void
  setApprovalHash: (hash: string | null) => void
  setSwapExecutionLoading: (loading: boolean) => void
  setSwapExecutionError: (error: string | null) => void
  setSwapHash: (hash: string | null) => void
  setSwapConfirmModalOpen: (open: boolean) => void

  setWalletError: (error: string | null) => void
  setConnectBusy: (busy: boolean) => void
  setDisconnectBusy: (busy: boolean) => void
  setSwitchBusy: (busy: boolean) => void

  addToHistory: (entry: SwapHistoryEntry) => void
  updateHistoryStatus: (hash: string, status: SwapHistoryEntry['status']) => void

  resetQuoteState: () => void
  resetSwapState: () => void
}

const MAX_HISTORY = 20

export const useSwapStore = create<SwapState>()(
  persist(
    (set, get) => ({
      selectedChain: 'bsc',
      tokenA: null,
      tokenB: null,
      amount: '',
      forceMultiHop: false,

      quoteResult: null,
      quoteError: null,
      quoteLoading: false,
      quoteCountdown: 0,

      allowanceState: null,
      preparedSwap: null,
      prepareLoading: false,
      prepareError: null,
      approvalLoading: null,
      approvalError: null,
      approvalHash: null,
      swapExecutionLoading: false,
      swapExecutionError: null,
      swapHash: null,
      swapConfirmModalOpen: false,

      swapHistory: [],

      walletError: null,
      connectBusy: false,
      disconnectBusy: false,
      switchBusy: false,

      setSelectedChain: (chain) => set({ selectedChain: chain }),
      setTokenA: (token) => set({ tokenA: token }),
      setTokenB: (token) => set({ tokenB: token }),
      setAmount: (amount) => set({ amount }),
      setForceMultiHop: (v) => set({ forceMultiHop: v }),
      swapTokens: () => {
        const { tokenA, tokenB } = get()
        set({ tokenA: tokenB, tokenB: tokenA })
      },

      setQuoteResult: (result) => set({ quoteResult: result }),
      setQuoteError: (error) => set({ quoteError: error }),
      setQuoteLoading: (loading) => set({ quoteLoading: loading }),
      setQuoteCountdown: (seconds) => set({ quoteCountdown: seconds }),

      setAllowanceState: (state) => set({ allowanceState: state }),
      setPreparedSwap: (swap) => set({ preparedSwap: swap }),
      setPrepareLoading: (loading) => set({ prepareLoading: loading }),
      setPrepareError: (error) => set({ prepareError: error }),
      setApprovalLoading: (loading) => set({ approvalLoading: loading }),
      setApprovalError: (error) => set({ approvalError: error }),
      setApprovalHash: (hash) => set({ approvalHash: hash }),
      setSwapExecutionLoading: (loading) => set({ swapExecutionLoading: loading }),
      setSwapExecutionError: (error) => set({ swapExecutionError: error }),
      setSwapHash: (hash) => set({ swapHash: hash }),
      setSwapConfirmModalOpen: (open) => set({ swapConfirmModalOpen: open }),

      setWalletError: (error) => set({ walletError: error }),
      setConnectBusy: (busy) => set({ connectBusy: busy }),
      setDisconnectBusy: (busy) => set({ disconnectBusy: busy }),
      setSwitchBusy: (busy) => set({ switchBusy: busy }),

      addToHistory: (entry) => {
        const history = [entry, ...get().swapHistory]
        if (history.length > MAX_HISTORY) history.length = MAX_HISTORY
        set({ swapHistory: history })
      },

      updateHistoryStatus: (hash, status) => {
        set({
          swapHistory: get().swapHistory.map(e =>
            e.hash === hash ? { ...e, status } : e,
          ),
        })
      },

      resetQuoteState: () => set({
        quoteResult: null,
        quoteError: null,
        preparedSwap: null,
        allowanceState: null,
      }),

      resetSwapState: () => set({
        preparedSwap: null,
        prepareLoading: false,
        prepareError: null,
        approvalLoading: null,
        approvalError: null,
        approvalHash: null,
        swapExecutionLoading: false,
        swapExecutionError: null,
        swapHash: null,
      }),
    }),
    {
      name: 'aequi_swap',
      partialize: (state) => ({
        selectedChain: state.selectedChain,
        swapHistory: state.swapHistory,
      }),
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return
          try {
            const legacy = localStorage.getItem('aequi_swap_history')
            if (legacy) {
              const entries: SwapHistoryEntry[] = JSON.parse(legacy)
              if (entries.length && !state.swapHistory.length) {
                state.swapHistory = entries
              }
              localStorage.removeItem('aequi_swap_history')
            }
          } catch {}
        }
      },
    },
  ),
)
