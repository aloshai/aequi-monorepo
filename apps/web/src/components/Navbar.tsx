import type { ChainKey } from '../types/api'
import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Settings2, Wallet, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LogoMark, Wordmark } from './Logo'
import { ThemeToggle } from './ThemeToggle'

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
  { key: 'base', label: 'Base' },
  { key: 'ink', label: 'Ink' },
  { key: 'incentiv', label: 'Incentiv' },
]

const CHAIN_LOGO: Record<ChainKey, string> = {
  ethereum: '/ethereum.svg',
  bsc: '/bnb.svg',
  base: '/base.svg',
  ink: '/ink.svg',
  incentiv: '/incentiv.svg',
}

function ChainIcon({ chain, size = 18 }: { chain: ChainKey; size?: number }) {
  return (
    <img
      src={CHAIN_LOGO[chain]}
      alt={chain}
      width={size}
      height={size}
      className="rounded-full"
    />
  )
}

function ChainSelector({ selected, onChange }: { selected: ChainKey; onChange: (c: ChainKey) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = CHAIN_OPTIONS.find((o) => o.key === selected)!

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChainIcon chain={selected} size={16} />
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-md border border-border bg-background p-1 shadow-lg">
          {CHAIN_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => { onChange(o.key); setOpen(false) }}
              className={`flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors hover:bg-accent ${o.key === selected ? 'bg-accent/60 font-medium' : ''}`}
            >
              <ChainIcon chain={o.key} size={18} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
    <nav className="navbar border-b border-border bg-background/95 backdrop-blur-md">
      <div className="navbar-inner max-w-6xl">
        <div className="rise flex items-center gap-2.5">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Aequi home">
            <LogoMark size={26} />
            <Wordmark className="navbar-brand text-[1.1rem]" />
          </Link>
          <Badge variant="outline" className="hidden sm:inline-flex font-mono-num text-[0.62rem] uppercase tracking-wider">Beta</Badge>
        </div>

        <div className="rise navbar-actions" style={{ animationDelay: '0.05s' }}>
          <ChainSelector selected={selectedChain} onChange={onChainChange} />

          {!isConnected ? (
            <Button className="h-9" onClick={onConnect} disabled={connectBusy}>
              <Wallet className="h-4 w-4" />
              {connectBusy ? 'Connecting…' : 'Connect'}
            </Button>
          ) : (
            <>
              <Badge variant="outline" className="h-9 px-3 font-mono text-xs text-muted-foreground">
                {shorten(address ?? '')}
              </Badge>
              {chainMismatch && (
                <Button variant="secondary" size="sm" className="h-9" onClick={onSwitchNetwork} disabled={switchBusy}>
                  Switch Network
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-9" onClick={onDisconnect} disabled={disconnectBusy}>
                Disconnect
              </Button>
            </>
          )}

          <ThemeToggle />

          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onOpenSettings} aria-label="Open settings" title="Settings">
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </nav>
  )
}
