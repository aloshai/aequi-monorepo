import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { AnimatePresence, motion } from 'framer-motion'
import type { ChainKey } from './types/api'
import { fetchExchangeDirectory } from './services/aequi-api'
import { tokenDirectory } from './data/token-directory'
import { CHAIN_BY_KEY } from './lib/wagmi'
import type { Token } from './services/token-manager'

import { useSwapStore } from './store/use-swap-store'
import { useSettingsStore } from './store/use-settings-store'
import { useTokenStore } from './store/use-token-store'
import { useUiStore } from './store/use-ui-store'
import { useTokenBalances, formatBigIntAmount } from './hooks/use-token-balances'
import { useQuotePoller } from './hooks/use-quote-poller'
import { useSwapExecution } from './hooks/use-swap-execution'
import { resolveErrorRecoveryAction } from './utils/error-recovery'
import { buildSwapSearch, parseSwapParams, resolveUrlToken } from './utils/swap-url'

import { Navbar } from './components/Navbar'
import { TokenInput } from './components/TokenInput'
import { QuoteDetails } from './components/QuoteDetails'
import { RouteVisual } from './components/RouteVisual'
import { DataTabs } from './components/DataTabs'
import { TokenModal } from './components/TokenModal'
import { SettingsModal } from './components/SettingsModal'
import { SwapConfirmModal } from './components/SwapConfirmModal'
import { SwapLifecyclePanel } from './components/SwapLifecyclePanel'
import { PoweredBy } from './components/PoweredBy'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type SupportedChainId =
  | typeof CHAIN_BY_KEY.ethereum.id
  | typeof CHAIN_BY_KEY.bsc.id
  | typeof CHAIN_BY_KEY.incentiv.id
  | typeof CHAIN_BY_KEY.ink.id
  | typeof CHAIN_BY_KEY.base.id

const CHAIN_ID_BY_KEY: Record<ChainKey, SupportedChainId> = {
  ethereum: CHAIN_BY_KEY.ethereum.id,
  bsc: CHAIN_BY_KEY.bsc.id,
  incentiv: CHAIN_BY_KEY.incentiv.id,
  ink: CHAIN_BY_KEY.ink.id,
  base: CHAIN_BY_KEY.base.id,
}

const BLOCK_EXPLORER_BY_CHAIN: Record<ChainKey, string> = {
  ethereum: 'https://etherscan.io',
  bsc: 'https://bscscan.com',
  incentiv: 'https://explorer.incentiv.io',
  ink: 'https://explorer.inkonchain.com',
  base: 'https://basescan.org',
}

const CHAIN_OPTIONS: Array<{ key: ChainKey; label: string }> = [
  { key: 'ethereum', label: 'Ethereum' },
  { key: 'bsc', label: 'BNB Smart Chain' },
  { key: 'base', label: 'Base' },
  { key: 'ink', label: 'Ink' },
  { key: 'incentiv', label: 'Incentiv' },
]

function App() {
  const {
    selectedChain, tokenA, tokenB, amount, forceMultiHop,
    quoteResult, quoteError, quoteLoading,
    preparedSwap, prepareLoading, prepareError,
    approvalLoading, approvalError, approvalHash,
    swapExecutionLoading, swapExecutionError, swapHash,
    swapHistory,
    setSelectedChain, setTokenA, setTokenB, setAmount,
    setForceMultiHop, swapTokens,
    resetQuoteState,
  } = useSwapStore()

  const {
    swapConfirmModalOpen,
    walletError,
    connectBusy,
    disconnectBusy,
    switchBusy,
    setWalletError,
    setConnectBusy,
    setDisconnectBusy,
    setSwitchBusy,
    setSwapConfirmModalOpen,
  } = useUiStore()

  const { slippageBps, setSlippageBps, deadlineSeconds, setDeadlineSeconds, version, setVersion, approvalMode, setApprovalMode, tokenFlow, setTokenFlow, settingsModalOpen, openSettings, closeSettings } = useSettingsStore()
  const { importedTokens, tokenModalOpen, selectingToken, importToken, openModal, closeModal } = useTokenStore()

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { connectors, connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()

  const selectedChainId: SupportedChainId = CHAIN_ID_BY_KEY[selectedChain]
  const chainMismatch = isConnected && !!chainId && chainId !== selectedChainId
  const defaultConnector = connectors[0]
  const selectedChainLabel = useMemo(
    () => CHAIN_OPTIONS.find(o => o.key === selectedChain)?.label ?? selectedChain,
    [selectedChain],
  )

  const { balanceA, fmtA, fmtB, isNativeA } = useTokenBalances(address)
  const { refetch: refetchQuote } = useQuotePoller()
  const { prepareSwap, confirmSwap } = useSwapExecution(address, isConnected, chainMismatch)

  const defaultTokens = useMemo(() => {
    const presets = tokenDirectory[selectedChain] ?? []
    const mapped: Token[] = presets.map(p => ({
      address: p.address, symbol: p.symbol, name: p.label, decimals: p.decimals, chainId: CHAIN_ID_BY_KEY[selectedChain],
    }))
    return [...mapped, ...importedTokens.filter(t => t.chainId === CHAIN_ID_BY_KEY[selectedChain])]
  }, [selectedChain, importedTokens])

  // Tracks whether the initial URL state has been applied, so the writer
  // effect doesn't clobber a shared link before it's been read.
  const urlConsumedRef = useRef(false)
  const [urlHydrated, setUrlHydrated] = useState(false)

  // One-time chain redirect: if a shared link names a chain other than the
  // persisted one, switch to it. That re-runs the default-token effect below,
  // which then consumes the URL's sell/buy/amount for the URL's chain.
  useEffect(() => {
    const parsed = parseSwapParams(window.location.search)
    if (parsed.chain && parsed.chain !== selectedChain) {
      setSelectedChain(parsed.chain)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const presets = tokenDirectory[selectedChain] || []
    const cid = CHAIN_ID_BY_KEY[selectedChain]

    // On the first run that targets the chain named in the URL (or any chain
    // when the URL omits one), hydrate the pair/amount from the link instead
    // of the defaults. Consumed only once so later chain switches reset cleanly.
    if (!urlConsumedRef.current) {
      const parsed = parseSwapParams(window.location.search)
      if (parsed.hasAny && (!parsed.chain || parsed.chain === selectedChain)) {
        urlConsumedRef.current = true
        const urlA = resolveUrlToken(parsed.sell, presets, importedTokens, cid)
        const urlB = resolveUrlToken(parsed.buy, presets, importedTokens, cid)
        if (urlA !== undefined || urlB !== undefined || parsed.amount) {
          const symA = selectedChain === 'bsc' ? 'BNB' : selectedChain === 'incentiv' ? 'CENT' : 'ETH'
          const symB = selectedChain === 'bsc' ? 'USDT' : selectedChain === 'ink' ? 'USDC.e' : 'USDC'
          const dA = presets.find(p => p.symbol === symA)
          const dB = presets.find(p => p.symbol === symB)
          const fallbackA = dA ? { address: dA.address, symbol: dA.symbol, name: dA.label, decimals: dA.decimals, chainId: cid } : null
          const fallbackB = dB ? { address: dB.address, symbol: dB.symbol, name: dB.label, decimals: dB.decimals, chainId: cid } : null
          setTokenA(urlA ?? fallbackA)
          setTokenB(urlB ?? fallbackB)
          setAmount(parsed.amount ?? '1')
          resetQuoteState()
          setUrlHydrated(true)
          return
        }
      }
    }

    const symA = selectedChain === 'bsc' ? 'BNB' : selectedChain === 'incentiv' ? 'CENT' : 'ETH'
    const symB = selectedChain === 'bsc' ? 'USDT' : selectedChain === 'ink' ? 'USDC.e' : 'USDC'
    const pA = presets.find(p => p.symbol === symA)
    const pB = presets.find(p => p.symbol === symB)
    setTokenA(pA ? { address: pA.address, symbol: pA.symbol, name: pA.label, decimals: pA.decimals, chainId: cid } : null)
    setTokenB(pB ? { address: pB.address, symbol: pB.symbol, name: pB.label, decimals: pB.decimals, chainId: cid } : null)
    setAmount('1')
    resetQuoteState()
    setUrlHydrated(true)
  }, [selectedChain, setTokenA, setTokenB, setAmount, resetQuoteState, importedTokens])

  // Mirror the live swap state into the URL (replaceState — no history spam) so
  // the address bar is always a shareable, returnable link.
  useEffect(() => {
    if (!urlHydrated) return
    const presets = tokenDirectory[selectedChain] || []
    const search = buildSwapSearch({ chain: selectedChain, tokenA, tokenB, amount }, presets)
    const next = `${window.location.pathname}?${search}`
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, '', next)
    }
  }, [urlHydrated, selectedChain, tokenA, tokenB, amount])

  useEffect(() => { fetchExchangeDirectory({ chain: selectedChain }).catch(() => {}) }, [selectedChain])

  const handleConnect = useCallback(async () => {
    setWalletError(null)
    if (!defaultConnector) { setWalletError('No injected wallet detected'); return }
    try { setConnectBusy(true); await connectAsync({ connector: defaultConnector }) }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Failed to connect') }
    finally { setConnectBusy(false) }
  }, [connectAsync, defaultConnector, setWalletError, setConnectBusy])

  const handleDisconnect = useCallback(async () => {
    setWalletError(null)
    try { setDisconnectBusy(true); await disconnectAsync() }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Failed to disconnect') }
    finally { setDisconnectBusy(false) }
  }, [disconnectAsync, setWalletError, setDisconnectBusy])

  const handleSwitchNetwork = useCallback(async () => {
    if (!switchChainAsync) { setWalletError('Network switching not supported'); return }
    setWalletError(null)
    try { setSwitchBusy(true); await switchChainAsync({ chainId: selectedChainId }) }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Failed to switch') }
    finally { setSwitchBusy(false) }
  }, [selectedChainId, switchChainAsync, setWalletError, setSwitchBusy])

  const handleTokenSelect = useCallback((token: Token) => {
    if (selectingToken === 'A') setTokenA(token)
    else if (selectingToken === 'B') setTokenB(token)
    if (token.isImported) importToken(token)
    closeModal()
  }, [selectingToken, setTokenA, setTokenB, importToken, closeModal])

  const handleSetMax = useCallback(() => {
    if (!tokenA) return
    if (isNativeA) {
      const buf = 10n ** BigInt(tokenA.decimals - 2)
      const safe = balanceA > buf ? balanceA - buf : 0n
      setAmount(formatBigIntAmount(safe, tokenA.decimals, 18))
    } else {
      setAmount(formatBigIntAmount(balanceA, tokenA.decimals, 18))
    }
  }, [balanceA, tokenA, isNativeA, setAmount])

  const handleSetHalf = useCallback(() => {
    if (!tokenA) return
    setAmount(formatBigIntAmount(balanceA / 2n, tokenA.decimals, 18))
  }, [balanceA, tokenA, setAmount])

  const handleSetQuarter = useCallback(() => {
    if (!tokenA) return
    setAmount(formatBigIntAmount(balanceA / 4n, tokenA.decimals, 18))
  }, [balanceA, tokenA, setAmount])

  const [copied, setCopied] = useState(false)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
      copyResetRef.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked (e.g. insecure context) — leave state unchanged.
    }
  }, [])
  useEffect(() => () => { if (copyResetRef.current) clearTimeout(copyResetRef.current) }, [])

  const outputDisplay = quoteResult
    ? formatBigIntAmount(BigInt(quoteResult.amountOut), tokenB?.decimals || 18)
    : ''

  const priceImpact = quoteResult ? quoteResult.priceImpactBps / 100 : 0
  const surfacedError = walletError || quoteError || prepareError || approvalError || swapExecutionError

  const handleSetSaferSlippage = useCallback(() => {
    setSlippageBps('100')
  }, [setSlippageBps])

  const recoveryAction = useMemo(
    () => resolveErrorRecoveryAction(surfacedError, {
      onRefreshQuote: () => {
        void refetchQuote()
      },
      onOpenSettings: openSettings,
      onSetSaferSlippage: handleSetSaferSlippage,
      onSwitchNetwork: () => {
        void handleSwitchNetwork()
      },
      onConnectWallet: () => {
        void handleConnect()
      },
    }),
    [surfacedError, refetchQuote, openSettings, handleSetSaferSlippage, handleSwitchNetwork, handleConnect],
  )

  const lifecycleState = useMemo(() => {
    if (!isConnected) {
      return {
        title: 'Connect your wallet to start',
        detail: 'Once connected, Aequi will begin live route discovery for your selected pair.',
        activeStep: 0,
        error: surfacedError,
      }
    }

    if (chainMismatch) {
      return {
        title: 'Switch to the selected network',
        detail: 'Your wallet network must match the chain selected in the header before execution.',
        activeStep: 0,
        error: surfacedError,
      }
    }

    if (quoteLoading) {
      return {
        title: 'Fetching quote and scoring routes',
        detail: 'Comparing route quality, impact, and gas across available pools.',
        activeStep: 1,
        error: surfacedError,
      }
    }

    if (prepareLoading) {
      return {
        title: 'Preparing transaction payload',
        detail: 'Building execution calldata and validating quote constraints.',
        activeStep: 2,
        error: surfacedError,
      }
    }

    if (approvalLoading || approvalHash) {
      return {
        title: approvalLoading === 'infinite' ? 'Waiting for unlimited approval confirmation' : 'Waiting for approval confirmation',
        detail: 'Approve the token spend request in your wallet to proceed to execution.',
        activeStep: 3,
        error: surfacedError,
      }
    }

    if (swapExecutionLoading || swapHash) {
      return {
        title: 'Executing swap transaction',
        detail: 'Your swap has been submitted. Confirmation may take a short while depending on network congestion.',
        activeStep: 3,
        error: surfacedError,
      }
    }

    if (swapHistory[0]?.status === 'confirmed' && amount === '' && !preparedSwap) {
      return {
        title: 'Swap confirmed on-chain',
        detail: 'Transaction completed successfully. You can start a new trade or review history and route analytics.',
        activeStep: 4,
        error: null,
      }
    }

    if (surfacedError) {
      return {
        title: 'Action required before continuing',
        detail: 'Review the error, update trade settings if needed, then retry.',
        activeStep: 2,
        error: surfacedError,
      }
    }

    if (quoteResult) {
      return {
        title: 'Quote ready for confirmation',
        detail: 'Review route quality and slippage, then open confirmation to execute.',
        activeStep: 2,
        error: null,
      }
    }

    return {
      title: 'Build your trade',
      detail: 'Select input/output tokens and enter an amount to begin route discovery.',
      activeStep: 0,
      error: null,
    }
  }, [
    surfacedError,
    isConnected,
    chainMismatch,
    quoteLoading,
    prepareLoading,
    approvalLoading,
    approvalHash,
    swapExecutionLoading,
    swapHash,
    swapHistory,
    amount,
    preparedSwap,
    quoteResult,
  ])

  return (
    <>
      <Navbar
        selectedChain={selectedChain}
        onChainChange={setSelectedChain}
        isConnected={isConnected}
        address={address}
        chainMismatch={chainMismatch}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onSwitchNetwork={handleSwitchNetwork}
        onOpenSettings={openSettings}
        connectBusy={connectBusy}
        disconnectBusy={disconnectBusy}
        switchBusy={switchBusy}
      />

      <main className="main-content px-4 pb-20 pt-10">
        <div className="rise flex w-full max-w-[480px] flex-col gap-3">
          <div className="mb-1 flex items-end justify-between px-1">
            <div>
              <h1 className="font-serif text-3xl tracking-tight text-foreground" style={{ fontWeight: 500 }}>Swap</h1>
              <p className="mt-1 text-sm text-muted-foreground">Best route across every pool — verified before you sign.</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyLink}
              aria-label={copied ? 'Link copied' : 'Copy shareable link'}
              title={copied ? 'Copied!' : 'Copy link to this swap'}
              className="nav-icon-btn shrink-0"
            >
              {copied ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--success)]">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={openSettings}
              aria-label="Swap settings"
              className="nav-icon-btn shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            </div>
          </div>

          <Card className="border-border bg-card elevate">
              <CardContent className="space-y-3 p-4 sm:p-5">
                <TokenInput
                  label="Sell"
                  token={tokenA}
                  amount={amount}
                  onAmountChange={setAmount}
                  onTokenSelect={() => openModal('A')}
                  balance={isConnected && tokenA ? `${fmtA} ${tokenA.symbol}` : undefined}
                  showShortcuts={isConnected}
                  onQuarter={handleSetQuarter}
                  onHalf={handleSetHalf}
                  onMax={handleSetMax}
                  shortcutsDisabled={!isConnected || !tokenA || balanceA === 0n}
                />

                <div className="swap-toggle">
                  <button className="swap-toggle-btn" onClick={swapTokens} aria-label="Switch sell and buy tokens">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </button>
                </div>

                <TokenInput
                  label="Buy"
                  token={tokenB}
                  amount={outputDisplay}
                  onTokenSelect={() => openModal('B')}
                  balance={isConnected && tokenB ? `${fmtB} ${tokenB.symbol}` : undefined}
                  readOnly
                />

                {import.meta.env.DEV && (
                  <div className="debug-options">
                    <label>
                      <input type="checkbox" checked={forceMultiHop} onChange={(e) => setForceMultiHop(e.target.checked)} />
                      <span>Force Multi-Hop (Debug)</span>
                    </label>
                    <p>Skip direct routes for testing</p>
                  </div>
                )}

                {surfacedError && (
                  <div className="error-message" role="alert" aria-live="assertive">
                    <div>{surfacedError}</div>
                    {recoveryAction && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 border-border bg-background text-xs text-foreground hover:bg-muted"
                        onClick={recoveryAction.run}
                      >
                        {recoveryAction.label}
                      </Button>
                    )}
                  </div>
                )}
                {approvalHash && (
                  <div className="info-message">
                    Approving... <a href={`${BLOCK_EXPLORER_BY_CHAIN[selectedChain]}/tx/${approvalHash}`} target="_blank" rel="noreferrer">View</a>
                  </div>
                )}
                {swapHash && (
                  <div className="info-message">
                    Swapping... <a href={`${BLOCK_EXPLORER_BY_CHAIN[selectedChain]}/tx/${swapHash}`} target="_blank" rel="noreferrer">View</a>
                  </div>
                )}

                <Button
                  className="h-12 w-full text-base font-semibold"
                  onClick={prepareSwap}
                  disabled={!tokenA || !tokenB || !amount || quoteLoading || prepareLoading || !!approvalLoading || swapExecutionLoading}
                >
                  {quoteLoading ? 'Fetching Quote...' :
                    prepareLoading ? 'Preparing...' :
                    approvalLoading ? 'Approving...' :
                    swapExecutionLoading ? 'Swapping...' :
                    'Swap'}
                </Button>
              </CardContent>
            </Card>

            {quoteLoading && (
              <div className="quote-loading">
                <div className="spinner" />
                <span>Finding best rates...</span>
              </div>
            )}

            <AnimatePresence>
              {quoteResult && tokenA && tokenB && (
                <motion.div
                  key="insights"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                  className="flex flex-col gap-3"
                >
                  {priceImpact > 15 && (
                    <div className="high-impact-banner">
                      Price impact is extremely high ({priceImpact.toFixed(2)}%). You may lose a significant portion of funds.
                    </div>
                  )}
                  <QuoteDetails quote={quoteResult} tokenA={tokenA} tokenB={tokenB} />
                  <RouteVisual quote={quoteResult} tokenB={tokenB} />
                  <DataTabs quote={quoteResult} tokenB={tokenB} />
                </motion.div>
              )}
            </AnimatePresence>

            <SwapLifecyclePanel
              title={lifecycleState.title}
              detail={lifecycleState.detail}
              activeStep={lifecycleState.activeStep}
              error={lifecycleState.error}
            />
        </div>
      </main>

      <PoweredBy />

      <TokenModal
        isOpen={tokenModalOpen}
        onClose={closeModal}
        onSelect={handleTokenSelect}
        defaultTokens={defaultTokens}
        chain={selectedChain}
        chainId={selectedChainId}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={closeSettings}
        slippageBps={slippageBps}
        setSlippageBps={setSlippageBps}
        deadlineSeconds={deadlineSeconds}
        setDeadlineSeconds={setDeadlineSeconds}
        version={version}
        setVersion={setVersion}
        recommendedSlippageBps={quoteResult?.recommendedSlippageBps}
        approvalMode={approvalMode}
        setApprovalMode={setApprovalMode}
        tokenFlow={tokenFlow}
        setTokenFlow={setTokenFlow}
      />

      <SwapConfirmModal
        isOpen={swapConfirmModalOpen}
        onClose={() => setSwapConfirmModalOpen(false)}
        onConfirm={confirmSwap}
        swapData={preparedSwap}
        loading={!!approvalLoading || swapExecutionLoading}
        error={approvalError || swapExecutionError}
        chain={selectedChainLabel}
      />
    </>
  )
}

export default App