import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Token } from '../services/token-manager'

const LEGACY_KEY = 'aequi_imported_tokens'

interface TokenState {
  importedTokens: Token[]
  tokenModalOpen: boolean
  selectingToken: 'A' | 'B' | null

  importToken: (token: Token) => void
  removeToken: (address: string) => void
  openModal: (selecting: 'A' | 'B') => void
  closeModal: () => void
}

export const useTokenStore = create<TokenState>()(
  persist(
    (set, get) => ({
      importedTokens: [],
      tokenModalOpen: false,
      selectingToken: null,

      importToken: (token) => {
        const existing = get().importedTokens
        if (existing.some(t => t.address.toLowerCase() === token.address.toLowerCase())) return
        set({ importedTokens: [...existing, { ...token, isImported: true }] })
      },

      removeToken: (address) => {
        set({ importedTokens: get().importedTokens.filter(t => t.address.toLowerCase() !== address.toLowerCase()) })
      },

      openModal: (selecting) => set({ tokenModalOpen: true, selectingToken: selecting }),
      closeModal: () => set({ tokenModalOpen: false, selectingToken: null }),
    }),
    {
      name: 'aequi_tokens',
      partialize: (state) => ({ importedTokens: state.importedTokens }),
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return
          try {
            const legacy = localStorage.getItem(LEGACY_KEY)
            if (legacy) {
              const tokens: Token[] = JSON.parse(legacy)
              if (tokens.length && !state.importedTokens.length) {
                state.importedTokens = tokens.map(t => ({ ...t, isImported: true }))
              }
              localStorage.removeItem(LEGACY_KEY)
            }
          } catch {}
        }
      },
    },
  ),
)
