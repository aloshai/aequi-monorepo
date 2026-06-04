import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type RoutePreference = 'auto' | 'v2' | 'v3'
type ApprovalMode = 'infinite' | 'exact'
/**
 * Execution backend selector — Aequi routes all swaps through 0x Settler.
 *   - 'settler-allowance-holder' (default): one-time approve(AllowanceHolder),
 *     then each swap is a single tx.
 *   - 'settler-permit2': one-time approve(Permit2), then each swap requires
 *     an EIP-712 signature in the wallet but is more gas-efficient and
 *     allows arbitrary nonce ordering.
 */
export type TokenFlow = 'settler-allowance-holder' | 'settler-permit2'

interface SettingsState {
  slippageBps: string
  deadlineSeconds: string
  version: RoutePreference
  approvalMode: ApprovalMode
  tokenFlow: TokenFlow
  settingsModalOpen: boolean

  setSlippageBps: (v: string) => void
  setDeadlineSeconds: (v: string) => void
  setVersion: (v: RoutePreference) => void
  setApprovalMode: (v: ApprovalMode) => void
  setTokenFlow: (v: TokenFlow) => void
  openSettings: () => void
  closeSettings: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default 0.5% (50 bps). Looser than 0.3% so MetaMask's pre-flight
      // simulation of Settler swaps reverts far less on thin-liquidity pools
      // (the 'this transaction will likely fail' false-positive), while
      // staying tight enough for normal trades. Users can still pick Auto.
      slippageBps: '50',
      deadlineSeconds: '600',
      version: 'auto' as RoutePreference,
      approvalMode: 'exact' as ApprovalMode,
      tokenFlow: 'settler-allowance-holder' as TokenFlow,
      settingsModalOpen: false,

      setSlippageBps: (v) => set({ slippageBps: v }),
      setDeadlineSeconds: (v) => set({ deadlineSeconds: v }),
      setVersion: (v) => set({ version: v }),
      setApprovalMode: (v) => set({ approvalMode: v }),
      setTokenFlow: (v) => set({ tokenFlow: v }),
      openSettings: () => set({ settingsModalOpen: true }),
      closeSettings: () => set({ settingsModalOpen: false }),
    }),
    {
      name: 'aequi_settings',
      partialize: (state) => ({
        slippageBps: state.slippageBps,
        deadlineSeconds: state.deadlineSeconds,
        version: state.version,
        approvalMode: state.approvalMode,
        tokenFlow: state.tokenFlow,
      }),
    },
  ),
)
