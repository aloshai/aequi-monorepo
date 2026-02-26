import { useCallback, useEffect, useMemo } from 'react'
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import type { ChainKey } from './types/api'
import { fetchExchangeDirectory } from './services/aequi-api'
import { tokenDirectory } from './data/token-directory'
import { CHAIN_BY_KEY } from './lib/wagmi'
import type { Token } from './services/token-manager'

import { useSwapStore } from './store/use-swap-store'
import { useSettingsStore } from './store/use-settings-store'
import { useTokenStore } from './store/use-token-store'
import { useTokenBalances, formatBigIntAmount } from './hooks/use-token-balances'
import { useQuotePoller } from './hooks/use-quote-poller'
import { useSwapExecution } from './hooks/use-swap-execution'

import { Navbar } from './components/Navbar'
import { TokenInput } from './components/TokenInput'
import { QuoteDetails } from './components/QuoteDetails'
import { RouteVisual } from './components/RouteVisual'
import { DataTabs } from './components/DataTabs'
import { TokenModal } from './components/TokenModal'
import { SettingsModal } from './components/SettingsModal'
import { SwapConfirmModal } from './components/SwapConfirmModal'
import { PoweredBy } from './components/PoweredBy'

type SupportedChainId = typeof CHAIN_BY_KEY.ethereum.id | typeof CHAIN_BY_KEY.bsc.id

const CHAIN_ID_BY_KEY: Record<ChainKey, SupportedChainId> = {
  ethereum: CHAIN_BY_KEY.ethereum.id,
  bsc: CHAIN_BY_KEY.bsc.id,
}

const BLOCK_EXPLORER_BY_CHAIN: Record<ChainKey, string> = {
  ethereum: 'https://etherscan.io',
  bsc: 'https://bscscan.com',
}

const CHAIN_OPTIONS: Array<{ key: ChainKey; label: string }> = [
  { key: 'ethereum', label: 'Ethereum' },
  { key: 'bsc', label: 'BNB Smart Chain' },
]

function App() {
  const {
    selectedChain, tokenA, tokenB, amount, forceMultiHop,
    quoteResult, quoteError, quoteLoading,
    preparedSwap, prepareLoading, prepareError,
    approvalLoading, approvalError, approvalHash,
    swapExecutionLoading, swapExecutionError, swapHash,
    swapConfirmModalOpen, walletError,
    connectBusy, disconnectBusy, switchBusy,
    setSelectedChain, setTokenA, setTokenB, setAmount,
    setForceMultiHop, swapTokens, setSwapConfirmModalOpen,
    setWalletError, setConnectBusy, setDisconnectBusy, setSwitchBusy,
    resetQuoteState,
  } = useSwapStore()

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
  useQuotePoller()
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
    const symA = selectedChain === 'bsc' ? 'BNB' : 'ETH'
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

      <main className="main-content">
        <div className="swap-card">
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
            <button className="swap-toggle-btn" onClick={swapTokens}>
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

          {walletError && <div className="error-message">{walletError}</div>}
          {quoteError && <div className="error-message">{quoteError}</div>}
          {(prepareError || approvalError || swapExecutionError) && (
            <div className="error-message">
              {prepareError || approvalError || swapExecutionError}
            </div>
          )}
          {approvalHash && (
            <div className="info-message">
              Approving… <a href={`${BLOCK_EXPLORER_BY_CHAIN[selectedChain]}/tx/${approvalHash}`} target="_blank" rel="noreferrer">View</a>
            </div>
          )}
          {swapHash && (
            <div className="info-message">
              Swapping… <a href={`${BLOCK_EXPLORER_BY_CHAIN[selectedChain]}/tx/${swapHash}`} target="_blank" rel="noreferrer">View</a>
            </div>
          )}

          <button
            className="swap-action-btn"
            onClick={prepareSwap}
            disabled={!tokenA || !tokenB || !amount || quoteLoading || prepareLoading || !!approvalLoading || swapExecutionLoading}
          >
            {quoteLoading ? 'Fetching Quote…' :
              prepareLoading ? 'Preparing…' :
              approvalLoading ? 'Approving…' :
              swapExecutionLoading ? 'Swapping…' :
              'Swap'}
          </button>
        </div>

        {quoteLoading && (
          <div className="quote-loading">
            <div className="spinner" />
            <span>Finding best rates…</span>
          </div>
        )}

        {quoteResult && tokenA && tokenB && (
          <>
            <QuoteDetails quote={quoteResult} tokenA={tokenA} tokenB={tokenB} />

            {priceImpact > 15 && (
              <div className="high-impact-banner">
                Price impact is extremely high ({priceImpact.toFixed(2)}%). You may lose a significant portion of funds.
              </div>
            )}

            <RouteVisual quote={quoteResult} tokenB={tokenB} />
            <DataTabs quote={quoteResult} tokenB={tokenB} />
          </>
        )}
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