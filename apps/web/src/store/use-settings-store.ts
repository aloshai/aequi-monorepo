import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type RoutePreference = 'auto' | 'v2' | 'v3'
type ApprovalMode = 'infinite' | 'exact'
/**
 * Execution backend selector:
 *   - 'aequi-executor' (default): the existing AequiExecutor multicall path.
 *   - 'settler-allowance-holder': route swaps through 0x Settler in
 *     AllowanceHolder mode. Requires a one-time approve(AllowanceHolder).
 *   - 'settler-permit2': route through Settler with Permit2 signatures.
 *     (Stub — server returns 501 until Plan 3 follow-up wires it.)
 */
export type TokenFlow = 'aequi-executor' | 'settler-allowance-holder' | 'settler-permit2'

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
      slippageBps: 'auto',
      deadlineSeconds: '600',
      version: 'auto' as RoutePreference,
      approvalMode: 'exact' as ApprovalMode,
      tokenFlow: 'aequi-executor' as TokenFlow,
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
