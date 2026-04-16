import type { ChainKey } from '../types/api'
import { motion } from 'framer-motion'
import { Settings2, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

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
  { key: 'incentiv', label: 'Incentiv' },
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
    <nav className="navbar border-b border-border bg-background/95 backdrop-blur-md">
      <div className="navbar-inner max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="flex items-center gap-3"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-sm font-bold text-primary">
            A
          </span>
          <span className="navbar-brand text-base font-semibold tracking-tight">Aequi Exchange</span>
          <Badge variant="outline" className="hidden sm:inline-flex">Beta</Badge>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.05, ease: 'easeOut' }}
          className="navbar-actions"
        >
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selectedChain}
            onChange={(e) => onChainChange(e.target.value as ChainKey)}
          >
            {CHAIN_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>

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

          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onOpenSettings} aria-label="Open settings" title="Settings">
            <Settings2 className="h-4 w-4" />
          </Button>
        </motion.div>
      </div>
    </nav>
  )
}
