import { create } from 'zustand'

interface UiState {
  swapConfirmModalOpen: boolean
  walletError: string | null
  connectBusy: boolean
  disconnectBusy: boolean
  switchBusy: boolean

  setSwapConfirmModalOpen: (open: boolean) => void
  setWalletError: (error: string | null) => void
  setConnectBusy: (busy: boolean) => void
  setDisconnectBusy: (busy: boolean) => void
  setSwitchBusy: (busy: boolean) => void
  resetUiState: () => void
}

export const useUiStore = create<UiState>((set) => ({
  swapConfirmModalOpen: false,
  walletError: null,
  connectBusy: false,
  disconnectBusy: false,
  switchBusy: false,

  setSwapConfirmModalOpen: (open) => set({ swapConfirmModalOpen: open }),
  setWalletError: (error) => set({ walletError: error }),
  setConnectBusy: (busy) => set({ connectBusy: busy }),
  setDisconnectBusy: (busy) => set({ disconnectBusy: busy }),
  setSwitchBusy: (busy) => set({ switchBusy: busy }),
  resetUiState: () => set({
    swapConfirmModalOpen: false,
    walletError: null,
    connectBusy: false,
    disconnectBusy: false,
    switchBusy: false,
  }),
}))
