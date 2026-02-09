const SWAP_HISTORY_KEY = 'aequi_swap_history'
const MAX_ENTRIES = 20

export interface SwapHistoryEntry {
  hash: string
  chain: string
  tokenInSymbol: string
  tokenOutSymbol: string
  amountIn: string
  amountOut: string
  timestamp: number
  status: 'pending' | 'confirmed' | 'failed'
}

export function getSwapHistory(): SwapHistoryEntry[] {
  try {
    const raw = localStorage.getItem(SWAP_HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addSwapHistoryEntry(entry: SwapHistoryEntry): void {
  const history = getSwapHistory()
  history.unshift(entry)
  if (history.length > MAX_ENTRIES) history.length = MAX_ENTRIES
  localStorage.setItem(SWAP_HISTORY_KEY, JSON.stringify(history))
}

export function updateSwapHistoryStatus(hash: string, status: SwapHistoryEntry['status']): void {
  const history = getSwapHistory()
  const entry = history.find((e) => e.hash === hash)
  if (entry) {
    entry.status = status
    localStorage.setItem(SWAP_HISTORY_KEY, JSON.stringify(history))
  }
}
