import { useCallback, useEffect, useMemo } from 'react'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type SupportedChainId = typeof CHAIN_BY_KEY.ethereum.id | typeof CHAIN_BY_KEY.bsc.id | typeof CHAIN_BY_KEY.incentiv.id

const CHAIN_ID_BY_KEY: Record<ChainKey, SupportedChainId> = {
  ethereum: CHAIN_BY_KEY.ethereum.id,
  bsc: CHAIN_BY_KEY.bsc.id,
  incentiv: CHAIN_BY_KEY.incentiv.id,
}

const BLOCK_EXPLORER_BY_CHAIN: Record<ChainKey, string> = {
  ethereum: 'https://etherscan.io',
  bsc: 'https://bscscan.com',
  incentiv: 'https://explorer.incentiv.io',
}

const CHAIN_OPTIONS: Array<{ key: ChainKey; label: string }> = [
  { key: 'ethereum', label: 'Ethereum' },
  { key: 'bsc', label: 'BNB Smart Chain' },
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

  const { slippageBps, setSlippageBps, deadlineSeconds, setDeadlineSeconds, version, setVersion, approvalMode, setApprovalMode, settingsModalOpen, openSettings, closeSettings } = useSettingsStore()
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

  useEffect(() => {
    const presets = tokenDirectory[selectedChain] || []
    const cid = CHAIN_ID_BY_KEY[selectedChain]
    const symA = selectedChain === 'bsc' ? 'BNB' : selectedChain === 'incentiv' ? 'CENT' : 'ETH'
    const symB = selectedChain === 'bsc' ? 'USDT' : 'USDC'
    const pA = presets.find(p => p.symbol === symA)
    const pB = presets.find(p => p.symbol === symB)
    setTokenA(pA ? { address: pA.address, symbol: pA.symbol, name: pA.label, decimals: pA.decimals, chainId: cid } : null)
    setTokenB(pB ? { address: pB.address, symbol: pB.symbol, name: pB.label, decimals: pB.decimals, chainId: cid } : null)
    setAmount('1')
    resetQuoteState()
  }, [selectedChain, setTokenA, setTokenB, setAmount, resetQuoteState])

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

      <main className="main-content px-4 pb-16 pt-8">
        <div className="grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)]">
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="space-y-3"
          >
            <Card className="border-border bg-card">
              <CardHeader className="pb-4">
                <CardTitle className="text-2xl">Swap</CardTitle>
                <CardDescription>
                  Compare routes, validate risk, and execute with a clear transaction lifecycle.
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-3">
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

            <SwapLifecyclePanel
              title={lifecycleState.title}
              detail={lifecycleState.detail}
              activeStep={lifecycleState.activeStep}
              error={lifecycleState.error}
            />
          </motion.section>

          <AnimatePresence mode="wait">
            {quoteResult && tokenA && tokenB ? (
              <motion.section
                key="insights"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
                className="space-y-3"
              >
                <QuoteDetails quote={quoteResult} tokenA={tokenA} tokenB={tokenB} />

                {priceImpact > 15 && (
                  <div className="high-impact-banner">
                    Price impact is extremely high ({priceImpact.toFixed(2)}%). You may lose a significant portion of funds.
                  </div>
                )}

                <RouteVisual quote={quoteResult} tokenB={tokenB} />
                <DataTabs quote={quoteResult} tokenB={tokenB} />
              </motion.section>
            ) : (
              <motion.section
                key="placeholder"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.24, ease: 'easeOut' }}
              >
                <Card className="border-border bg-card">
                  <CardContent className="p-6 text-sm text-muted-foreground">
                    Enter an amount and token pair to load quote quality, route details, and execution insights.
                  </CardContent>
                </Card>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </main>

      <PoweredBy />

      <TokenModal
        isOpen={tokenModalOpen}
        onClose={closeModal}
        onSelect={handleTokenSelect}
        defaultTokens={defaultTokens}
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