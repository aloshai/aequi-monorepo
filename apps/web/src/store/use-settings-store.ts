import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type RoutePreference = 'auto' | 'v2' | 'v3'
type ApprovalMode = 'infinite' | 'exact'

interface SettingsState {
  slippageBps: string
  deadlineSeconds: string
  version: RoutePreference
  approvalMode: ApprovalMode
  settingsModalOpen: boolean

  setSlippageBps: (v: string) => void
  setDeadlineSeconds: (v: string) => void
  setVersion: (v: RoutePreference) => void
  setApprovalMode: (v: ApprovalMode) => void
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
      settingsModalOpen: false,

      setSlippageBps: (v) => set({ slippageBps: v }),
      setDeadlineSeconds: (v) => set({ deadlineSeconds: v }),
      setVersion: (v) => set({ version: v }),
      setApprovalMode: (v) => set({ approvalMode: v }),
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
      }),
    },
  ),
)
