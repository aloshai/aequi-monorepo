import { useCallback, useEffect, useRef } from 'react'
import { useSwapStore } from '../store/use-swap-store'
import { useSettingsStore } from '../store/use-settings-store'
import { fetchSwapQuote } from '../services/aequi-api'
import { resolveApiErrorMessage } from '../lib/http'

const QUOTE_INTERVAL_MS = 30_000
const DEBOUNCE_MS = 600

export function useQuotePoller() {
  const {
    tokenA, tokenB, amount, selectedChain, forceMultiHop,
    setQuoteResult, setQuoteError, setQuoteLoading, setQuoteCountdown,
    resetQuoteState,
  } = useSwapStore()
  const { slippageBps, version } = useSettingsStore()

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchQuote = useCallback(async () => {
    const tA = tokenA?.address
    const tB = tokenB?.address
    const amt = amount.trim()
    if (!tA || !tB || !amt) return
    if (tA.toLowerCase() === tB.toLowerCase()) {
      setQuoteError('Tokens must be different')
      return
    }

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setQuoteLoading(true)
    setQuoteError(null)
    resetQuoteState()

    try {
      const data = await fetchSwapQuote({
        chain: selectedChain,
        tokenA: tA,
        tokenB: tB,
        amount: amt,
        slippageBps: slippageBps === 'auto' ? 'auto' : (slippageBps.trim() || undefined),
        version,
        forceMultiHop: forceMultiHop ? 'true' as const : undefined,
      })
      setQuoteResult(data)
      setQuoteCountdown(Math.floor(QUOTE_INTERVAL_MS / 1000))
    } catch (e) {
      setQuoteError(resolveApiErrorMessage(e))
    } finally {
      setQuoteLoading(false)
    }
  }, [tokenA, tokenB, amount, selectedChain, slippageBps, version, forceMultiHop, setQuoteResult, setQuoteError, setQuoteLoading, setQuoteCountdown, resetQuoteState])

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (countdownRef.current) clearInterval(countdownRef.current)

    const debounce = setTimeout(() => {
      if (tokenA && tokenB && amount.trim()) {
        fetchQuote()

        intervalRef.current = setInterval(fetchQuote, QUOTE_INTERVAL_MS)
        countdownRef.current = setInterval(() => {
          useSwapStore.setState((s) => ({
            quoteCountdown: Math.max(0, s.quoteCountdown - 1),
          }))
        }, 1000)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(debounce)
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [tokenA, tokenB, amount, fetchQuote])

  return { refetch: fetchQuote }
}
