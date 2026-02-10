import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSendTransaction,
  useSwitchChain,
  useReadContract,
  useBalance,
} from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import type { AllowanceResponse, ChainKey, QuoteResponse, SwapResponse } from './types/api'
import {
  fetchAllowances,
  fetchExchangeDirectory,
  fetchSwapQuote,
  requestApproveCalldata,
  requestSwapTransaction,
} from './services/aequi-api'
import { resolveApiErrorMessage, resolveApiErrorPayload } from './lib/http'
import { tokenDirectory } from './data/token-directory'
import { CHAIN_BY_KEY, wagmiConfig } from './lib/wagmi'
import { tokenManager } from './services/token-manager'
import type { Token } from './services/token-manager'
import { parseSwapError } from './utils/swap-errors'
import { addSwapHistoryEntry, getSwapHistory, updateSwapHistoryStatus } from './services/swap-history'

import { Navbar } from './components/Navbar'
import { TokenInput } from './components/TokenInput'
import { QuoteDetails } from './components/QuoteDetails'
import { RouteVisual } from './components/RouteVisual'
import { DataTabs } from './components/DataTabs'
import { TokenModal } from './components/TokenModal'
import { SettingsModal } from './components/SettingsModal'
import { SwapConfirmModal } from './components/SwapConfirmModal'

type RoutePreference = 'auto' | 'v2' | 'v3'
type SupportedChainId = typeof CHAIN_BY_KEY.ethereum.id | typeof CHAIN_BY_KEY.bsc.id

const CHAIN_ID_BY_KEY: Record<ChainKey, SupportedChainId> = {
  ethereum: CHAIN_BY_KEY.ethereum.id,
  bsc: CHAIN_BY_KEY.bsc.id,
}

const BLOCK_EXPLORER_BY_CHAIN: Record<ChainKey, string> = {
  ethereum: 'https://etherscan.io',
  bsc: 'https://bscscan.com',
}

const chainOptions: Array<{ key: ChainKey; label: string }> = [
  { key: 'ethereum', label: 'Ethereum' },
  { key: 'bsc', label: 'BNB Smart Chain' },
]

const formatBigIntAmount = (value: bigint, decimals: number, precision = 6): string => {
  if (value === 0n) return '0'
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const remainder = value % divisor
  if (remainder === 0n) return whole.toString()
  const fracStr = remainder.toString().padStart(decimals, '0').slice(0, precision)
  const trimmed = fracStr.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole.toString()
}

interface QuoteFormState {
  tokenA: Token | null
  tokenB: Token | null
  amount: string
  slippageBps: string
  version: RoutePreference
  deadlineSeconds: string
}

function App() {
  const [selectedChain, setSelectedChain] = useState<ChainKey>('bsc')

  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [swapConfirmModalOpen, setSwapConfirmModalOpen] = useState(false)
  const [selectingToken, setSelectingToken] = useState<'A' | 'B' | null>(null)
  const [importedTokens, setImportedTokens] = useState<Token[]>([])

  useEffect(() => { setImportedTokens(tokenManager.getImportedTokens()) }, [])

  const defaultTokens = useMemo(() => {
    const presets = tokenDirectory[selectedChain] ?? []
    const mapped: Token[] = presets.map(p => ({
      address: p.address, symbol: p.symbol, name: p.label, decimals: p.decimals, chainId: CHAIN_ID_BY_KEY[selectedChain],
    }))
    return [...mapped, ...importedTokens.filter(t => t.chainId === CHAIN_ID_BY_KEY[selectedChain])]
  }, [selectedChain, importedTokens])

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { connectors, connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()

  const [walletError, setWalletError] = useState<string | null>(null)
  const [connectBusy, setConnectBusy] = useState(false)
  const [disconnectBusy, setDisconnectBusy] = useState(false)
  const [switchBusy, setSwitchBusy] = useState(false)

  const selectedChainId: SupportedChainId = CHAIN_ID_BY_KEY[selectedChain]
  const chainMismatch = isConnected && !!chainId && chainId !== selectedChainId
  const defaultConnector = connectors[0]

  const handleConnect = useCallback(async () => {
    setWalletError(null)
    if (!defaultConnector) { setWalletError('No injected wallet detected'); return }
    try { setConnectBusy(true); await connectAsync({ connector: defaultConnector }) }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Failed to connect') }
    finally { setConnectBusy(false) }
  }, [connectAsync, defaultConnector])

  const handleDisconnect = useCallback(async () => {
    setWalletError(null)
    try { setDisconnectBusy(true); await disconnectAsync() }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Failed to disconnect') }
    finally { setDisconnectBusy(false) }
  }, [disconnectAsync])

  const handleSwitchNetwork = useCallback(async () => {
    if (!switchChainAsync) { setWalletError('Network switching not supported'); return }
    setWalletError(null)
    try { setSwitchBusy(true); await switchChainAsync({ chainId: selectedChainId }) }
    catch (e) { setWalletError(e instanceof Error ? e.message : 'Failed to switch') }
    finally { setSwitchBusy(false) }
  }, [selectedChainId, switchChainAsync])

  const [quoteForm, setQuoteForm] = useState<QuoteFormState>({
    tokenA: null, tokenB: null, amount: '', slippageBps: '50', version: 'auto', deadlineSeconds: '600',
  })
  const [forceMultiHop, setForceMultiHop] = useState(false)

  const [quoteResult, setQuoteResult] = useState<QuoteResponse | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)

  const [, setAllowanceState] = useState<AllowanceResponse | null>(null)
  const [preparedSwap, setPreparedSwap] = useState<SwapResponse | null>(null)
  const [prepareLoading, setPrepareLoading] = useState(false)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [approvalLoading, setApprovalLoading] = useState<'exact' | 'infinite' | null>(null)
  const [approvalError, setApprovalError] = useState<string | null>(null)
  const [approvalHash, setApprovalHash] = useState<string | null>(null)
  const [swapExecutionLoading, setSwapExecutionLoading] = useState(false)
  const [swapExecutionError, setSwapExecutionError] = useState<string | null>(null)
  const [swapHash, setSwapHash] = useState<string | null>(null)
  const [, setSwapHistory] = useState(() => getSwapHistory())

  useEffect(() => {
    const presets = tokenDirectory[selectedChain] || []
    const cid = CHAIN_ID_BY_KEY[selectedChain]
    const symA = selectedChain === 'bsc' ? 'BNB' : 'ETH'
    const symB = selectedChain === 'bsc' ? 'USDT' : 'USDC'
    const pA = presets.find(p => p.symbol === symA)
    const pB = presets.find(p => p.symbol === symB)
    const tA = pA ? { address: pA.address, symbol: pA.symbol, name: pA.label, decimals: pA.decimals, chainId: cid } : null
    const tB = pB ? { address: pB.address, symbol: pB.symbol, name: pB.label, decimals: pB.decimals, chainId: cid } : null
    setQuoteForm(prev => ({ ...prev, tokenA: tA, tokenB: tB, amount: '1' }))
    setQuoteResult(null)
    setPreparedSwap(null)
    setAllowanceState(null)
  }, [selectedChain])

  const selectedChainLabel = useMemo(
    () => chainOptions.find(o => o.key === selectedChain)?.label ?? selectedChain,
    [selectedChain],
  )

  // Balances
  const { data: nativeBalance } = useBalance({ address, chainId: selectedChainId })
  const isNativeA = quoteForm.tokenA?.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  const isNativeB = quoteForm.tokenB?.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

  const erc20Abi = [{
    name: 'balanceOf' as const, type: 'function' as const, stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }],
  }]

  const { data: tokenABalance } = useReadContract({
    address: quoteForm.tokenA && !isNativeA ? quoteForm.tokenA.address as `0x${string}` : undefined,
    abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined,
    chainId: selectedChainId, query: { enabled: !!address && !!quoteForm.tokenA && !isNativeA },
  })

  const { data: tokenBBalance } = useReadContract({
    address: quoteForm.tokenB && !isNativeB ? quoteForm.tokenB.address as `0x${string}` : undefined,
    abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined,
    chainId: selectedChainId, query: { enabled: !!address && !!quoteForm.tokenB && !isNativeB },
  })

  const balanceA = useMemo(() => {
    if (!quoteForm.tokenA) return 0n
    if (isNativeA) return nativeBalance?.value ?? 0n
    return (tokenABalance as unknown as bigint) ?? 0n
  }, [quoteForm.tokenA, isNativeA, nativeBalance, tokenABalance])

  const balanceB = useMemo(() => {
    if (!quoteForm.tokenB) return 0n
    if (isNativeB) return nativeBalance?.value ?? 0n
    return (tokenBBalance as unknown as bigint) ?? 0n
  }, [quoteForm.tokenB, isNativeB, nativeBalance, tokenBBalance])

  const fmtA = useMemo(() => quoteForm.tokenA ? formatBigIntAmount(balanceA, quoteForm.tokenA.decimals) : '0', [balanceA, quoteForm.tokenA])
  const fmtB = useMemo(() => quoteForm.tokenB ? formatBigIntAmount(balanceB, quoteForm.tokenB.decimals) : '0', [balanceB, quoteForm.tokenB])

  const handleSetMax = useCallback(() => {
    if (!quoteForm.tokenA) return
    if (isNativeA) {
      const buf = 10n ** BigInt(quoteForm.tokenA.decimals - 2)
      const safe = balanceA > buf ? balanceA - buf : 0n
      setQuoteForm(prev => ({ ...prev, amount: formatBigIntAmount(safe, quoteForm.tokenA!.decimals, 18) }))
    } else {
      setQuoteForm(prev => ({ ...prev, amount: formatBigIntAmount(balanceA, quoteForm.tokenA!.decimals, 18) }))
    }
  }, [balanceA, quoteForm.tokenA, isNativeA])

  const handleSetHalf = useCallback(() => {
    if (!quoteForm.tokenA) return
    setQuoteForm(prev => ({ ...prev, amount: formatBigIntAmount(balanceA / 2n, quoteForm.tokenA!.decimals, 18) }))
  }, [balanceA, quoteForm.tokenA])

  useEffect(() => { fetchExchangeDirectory({ chain: selectedChain }).catch(() => {}) }, [selectedChain])

  const onQuoteRequest = useCallback(async () => {
    const tA = quoteForm.tokenA?.address
    const tB = quoteForm.tokenB?.address
    const amt = quoteForm.amount.trim()
    if (!tA || !tB || !amt) return
    if (tA.toLowerCase() === tB.toLowerCase()) { setQuoteError('Tokens must be different'); return }
    setQuoteLoading(true); setQuoteError(null); setPreparedSwap(null); setAllowanceState(null)
    try {
      const data = await fetchSwapQuote({
        chain: selectedChain, tokenA: tA, tokenB: tB, amount: amt,
        slippageBps: quoteForm.slippageBps.trim() || undefined,
        version: quoteForm.version,
        forceMultiHop: forceMultiHop ? 'true' as const : undefined,
      })
      setQuoteResult(data)
    } catch (e) {
      setQuoteError(resolveApiErrorMessage(e))
    } finally { setQuoteLoading(false) }
  }, [quoteForm, selectedChain, forceMultiHop])

  useEffect(() => {
    const t = setTimeout(() => { if (quoteForm.tokenA && quoteForm.tokenB && quoteForm.amount) onQuoteRequest() }, 600)
    return () => clearTimeout(t)
  }, [quoteForm.tokenA, quoteForm.tokenB, quoteForm.amount, onQuoteRequest])

  const onSwapTokens = useCallback(() => {
    setQuoteForm(prev => ({ ...prev, tokenA: prev.tokenB, tokenB: prev.tokenA }))
  }, [])

  const handleTokenSelect = (token: Token) => {
    if (selectingToken === 'A') setQuoteForm(prev => ({ ...prev, tokenA: token }))
    else if (selectingToken === 'B') setQuoteForm(prev => ({ ...prev, tokenB: token }))
    if (token.isImported) { tokenManager.addImportedToken(token); setImportedTokens(tokenManager.getImportedTokens()) }
    setTokenModalOpen(false); setSelectingToken(null)
  }

  const refreshAllowance = useCallback(
    async (token: string, spender: string, options?: { silent?: boolean }): Promise<AllowanceResponse | null> => {
      if (!address) return null
      const silent = Boolean(options?.silent)
      try {
        const data = await fetchAllowances({ chain: selectedChain, owner: address, spender, tokens: [token] })
        setAllowanceState(data)
        return data
      } catch (e) {
        if (!silent) resolveApiErrorPayload(e)
        return null
      }
    },
    [address, selectedChain],
  )

  const ensureAllowanceSynced = useCallback(async (): Promise<boolean> => {
    if (!preparedSwap?.tokens.length) return false
    const tokenAddr = preparedSwap.tokens[0]!.address
    const spender = preparedSwap.transaction.spender
    let required = 0n
    try { required = BigInt(preparedSwap.transaction.amountIn) } catch { required = 0n }
    for (let i = 0; i < 4; i++) {
      const resp = await refreshAllowance(tokenAddr, spender, { silent: i > 0 })
      if (resp) {
        const entry = resp.allowances.find(a => a.token.toLowerCase() === tokenAddr.toLowerCase())
        if (entry) { try { if (BigInt(entry.allowance) >= required) return true } catch {} }
      }
      if (i < 3) await new Promise(r => setTimeout(r, 1500))
    }
    return false
  }, [preparedSwap, refreshAllowance])

  const onExecuteSwapFlow = useCallback(async () => {
    if (!quoteResult) { setSwapExecutionError('Request a quote first'); return }
    const quoteAge = Date.now() - (quoteResult as unknown as SwapResponse).quoteTimestamp * 1000
    if ('quoteTimestamp' in quoteResult && quoteAge > 60_000) {
      setSwapExecutionError('Quote is stale — please refresh'); return
    }
    if (!address || !isConnected) { setSwapExecutionError('Connect wallet'); return }
    if (chainMismatch) {
      setSwapExecutionError(`Switch to ${chainOptions.find(o => o.key === selectedChain)?.label ?? selectedChain}`); return
    }
    const tA = quoteForm.tokenA?.address; const tB = quoteForm.tokenB?.address
    const amt = quoteForm.amount.trim()
    if (!tA || !tB) return

    setPrepareLoading(true); setPrepareError(null)
    try {
      const swapData = await requestSwapTransaction({
        chain: selectedChain, tokenA: tA, tokenB: tB, amount: amt,
        slippageBps: quoteForm.slippageBps.trim() ? Number(quoteForm.slippageBps) : undefined,
        version: quoteForm.version, recipient: address,
        deadlineSeconds: quoteForm.deadlineSeconds.trim() ? Number(quoteForm.deadlineSeconds) : undefined,
        forceMultiHop,
      })
      setPreparedSwap(swapData)
      setPrepareLoading(false)
      setSwapConfirmModalOpen(true)
    } catch (e) {
      setPrepareError(resolveApiErrorMessage(e)); setPrepareLoading(false)
    }
  }, [address, chainMismatch, quoteResult, quoteForm, selectedChain, isConnected, forceMultiHop])

  const onConfirmSwap = useCallback(async () => {
    if (!preparedSwap) return
    setApprovalError(null); setSwapExecutionError(null)
    try {
      const inputToken = preparedSwap.tokens[0]?.address
      if (!inputToken) throw new Error('Input token metadata unavailable')
      const allowanceData = await refreshAllowance(inputToken, preparedSwap.transaction.spender, { silent: true })
      let needsApproval = true
      if (allowanceData) {
        const entry = allowanceData.allowances.find(a => a.token.toLowerCase() === inputToken.toLowerCase())
        if (entry) { try { if (BigInt(entry.allowance) >= BigInt(preparedSwap.transaction.amountIn)) needsApproval = false } catch {} }
      }
      if (needsApproval) {
        setApprovalLoading('infinite')
        const approvalData = await requestApproveCalldata({
          chain: selectedChain, token: inputToken, spender: preparedSwap.transaction.spender, infinite: true,
        })
        const txTarget = approvalData.transaction?.to; const txData = approvalData.transaction?.data
        if (!txTarget || !txData) throw new Error('Approval payload missing')
        const aTx = await sendTransactionAsync({
          chainId: selectedChainId, to: txTarget as `0x${string}`, data: txData as `0x${string}`,
          value: BigInt(approvalData.transaction?.value ?? '0'),
        })
        setApprovalHash(aTx)
        await waitForTransactionReceipt(wagmiConfig, { chainId: selectedChainId, hash: aTx })
        setApprovalHash(null); setApprovalLoading(null)
        await ensureAllowanceSynced()
      }

      setSwapExecutionLoading(true)
      if (!preparedSwap.transaction.call) throw new Error('Missing transaction payload')
      const gas = preparedSwap.transaction.estimatedGas ? BigInt(preparedSwap.transaction.estimatedGas) : undefined
      const sTx = await sendTransactionAsync({
        chainId: selectedChainId,
        to: preparedSwap.transaction.call.to as `0x${string}`,
        data: preparedSwap.transaction.call.data as `0x${string}`,
        value: BigInt(preparedSwap.transaction.call.value ?? '0'),
        gas,
      })
      setSwapHash(sTx)

      const tInSym = preparedSwap.tokens[0]?.symbol ?? '?'
      const tOutSym = preparedSwap.tokens[preparedSwap.tokens.length - 1]?.symbol ?? '?'
      addSwapHistoryEntry({
        hash: sTx, chain: selectedChain, tokenInSymbol: tInSym, tokenOutSymbol: tOutSym,
        amountIn: preparedSwap.amountInFormatted, amountOut: preparedSwap.amountOutFormatted,
        timestamp: Date.now(), status: 'pending',
      })
      setSwapHistory(getSwapHistory())

      await waitForTransactionReceipt(wagmiConfig, { chainId: selectedChainId, hash: sTx })
      updateSwapHistoryStatus(sTx, 'confirmed')
      setSwapHistory(getSwapHistory())
      setSwapHash(null)
      setQuoteResult(null)
      setQuoteForm(prev => ({ ...prev, amount: '' }))
      setSwapConfirmModalOpen(false)
      setPreparedSwap(null)
    } catch (e) {
      if (approvalLoading) {
        setApprovalError(resolveApiErrorMessage(e))
      } else {
        const msg = parseSwapError(e)
        setSwapExecutionError(msg)
        if (swapHash) { updateSwapHistoryStatus(swapHash, 'failed'); setSwapHistory(getSwapHistory()) }
      }
      setApprovalHash(null); setSwapHash(null)
    } finally {
      setApprovalLoading(null); setSwapExecutionLoading(false)
    }
  }, [preparedSwap, refreshAllowance, selectedChain, selectedChainId, sendTransactionAsync, ensureAllowanceSynced, approvalLoading, swapHash])

  const outputDisplay = quoteResult
    ? formatBigIntAmount(BigInt(quoteResult.amountOut), quoteForm.tokenB?.decimals || 18)
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
        onOpenSettings={() => setSettingsModalOpen(true)}
        connectBusy={connectBusy}
        disconnectBusy={disconnectBusy}
        switchBusy={switchBusy}
      />

      <main className="main-content">
        <div className="swap-card">
          <TokenInput
            label="Sell"
            token={quoteForm.tokenA}
            amount={quoteForm.amount}
            onAmountChange={(v) => setQuoteForm(prev => ({ ...prev, amount: v }))}
            onTokenSelect={() => { setSelectingToken('A'); setTokenModalOpen(true) }}
            balance={isConnected && quoteForm.tokenA ? `${fmtA} ${quoteForm.tokenA.symbol}` : undefined}
            showShortcuts={isConnected}
            onHalf={handleSetHalf}
            onMax={handleSetMax}
            shortcutsDisabled={!isConnected || !quoteForm.tokenA || balanceA === 0n}
          />

          <div className="swap-toggle">
            <button className="swap-toggle-btn" onClick={onSwapTokens}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          <TokenInput
            label="Buy"
            token={quoteForm.tokenB}
            amount={outputDisplay}
            onTokenSelect={() => { setSelectingToken('B'); setTokenModalOpen(true) }}
            balance={isConnected && quoteForm.tokenB ? `${fmtB} ${quoteForm.tokenB.symbol}` : undefined}
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
            onClick={onExecuteSwapFlow}
            disabled={!quoteForm.tokenA || !quoteForm.tokenB || !quoteForm.amount || quoteLoading || prepareLoading || !!approvalLoading || swapExecutionLoading}
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

        {quoteResult && quoteForm.tokenA && quoteForm.tokenB && (
          <>
            <QuoteDetails quote={quoteResult} tokenA={quoteForm.tokenA} tokenB={quoteForm.tokenB} />

            {priceImpact > 15 && (
              <div className="high-impact-banner">
                Price impact is extremely high ({priceImpact.toFixed(2)}%). You may lose a significant portion of funds.
              </div>
            )}

            <RouteVisual quote={quoteResult} tokenB={quoteForm.tokenB} />
            <DataTabs quote={quoteResult} tokenB={quoteForm.tokenB} />
          </>
        )}
      </main>

      <TokenModal
        isOpen={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        onSelect={handleTokenSelect}
        defaultTokens={defaultTokens}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        slippageBps={quoteForm.slippageBps}
        setSlippageBps={(v) => setQuoteForm(prev => ({ ...prev, slippageBps: v }))}
        deadlineSeconds={quoteForm.deadlineSeconds}
        setDeadlineSeconds={(v) => setQuoteForm(prev => ({ ...prev, deadlineSeconds: v }))}
        version={quoteForm.version}
        setVersion={(v) => setQuoteForm(prev => ({ ...prev, version: v }))}
      />

      <SwapConfirmModal
        isOpen={swapConfirmModalOpen}
        onClose={() => setSwapConfirmModalOpen(false)}
        onConfirm={onConfirmSwap}
        swapData={preparedSwap}
        loading={!!approvalLoading || swapExecutionLoading}
        error={approvalError || swapExecutionError}
        chain={selectedChainLabel}
      />
    </>
  )
}

export default App