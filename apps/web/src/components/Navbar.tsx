import type { ChainKey } from '../types/api'

interface NavbarProps {
  selectedChain: ChainKey
  onChainChange: (chain: ChainKey) => void
  isConnected: boolean
  address?: string
  chainMismatch: boolean
  onConnect: () => void
  onDisconnect: () => void
  onSwitchNetwork: () => void
  onOpenSettings: () => void
  connectBusy: boolean
  disconnectBusy: boolean
  switchBusy: boolean
}

const CHAIN_OPTIONS: Array<{ key: ChainKey; label: string }> = [
  { key: 'ethereum', label: 'Ethereum' },
  { key: 'bsc', label: 'BNB Chain' },
]

const shorten = (addr: string) =>
  addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr

export function Navbar({
  selectedChain,
  onChainChange,
  isConnected,
  address,
  chainMismatch,
  onConnect,
  onDisconnect,
  onSwitchNetwork,
  onOpenSettings,
  connectBusy,
  disconnectBusy,
  switchBusy,
}: NavbarProps) {
  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <span className="navbar-brand">Aequi</span>

        <div className="navbar-actions">
          <select
            className="chain-select"
            value={selectedChain}
            onChange={(e) => onChainChange(e.target.value as ChainKey)}
          >
            {CHAIN_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>

          {!isConnected ? (
            <button className="nav-btn nav-btn--accent" onClick={onConnect} disabled={connectBusy}>
              {connectBusy ? 'Connecting…' : 'Connect'}
            </button>
          ) : (
            <>
              <span className="wallet-address">{shorten(address ?? '')}</span>
              {chainMismatch && (
                <button className="nav-btn" onClick={onSwitchNetwork} disabled={switchBusy}>
                  Switch Network
                </button>
              )}
              <button className="nav-btn nav-btn--danger" onClick={onDisconnect} disabled={disconnectBusy}>
                Disconnect
              </button>
            </>
          )}

          <button className="nav-icon-btn" onClick={onOpenSettings} title="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  )
}
