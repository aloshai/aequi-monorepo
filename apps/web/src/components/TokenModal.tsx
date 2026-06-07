import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { searchTokens } from '../services/dexscreener'
import type { Token } from '../services/token-manager'
import type { ChainKey } from '../types/api'
import { getTokenLogo } from '../utils/logos'
import { useTokenStore } from '../store/use-token-store'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface TokenModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (token: Token) => void
  defaultTokens: Token[]
  chain: ChainKey
  chainId: number
}

export function TokenModal({ isOpen, onClose, onSelect, defaultTokens, chain, chainId }: TokenModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Token[]>([])
  const [loading, setLoading] = useState(false)
  const { removeToken } = useTokenStore()

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      setSearchResults([])
    }
  }, [isOpen])

  useEffect(() => {
    const search = async () => {
      if (!searchQuery.trim()) {
        setSearchResults([])
        return
      }

      setLoading(true)
      try {
        const results = await searchTokens(searchQuery, chain, chainId)
        setSearchResults(results)
      } catch {
        setSearchResults([])
      } finally {
        setLoading(false)
      }
    }

    const debounce = setTimeout(search, 400)
    return () => clearTimeout(debounce)
  }, [searchQuery, chain, chainId])

  const handleRemoveImported = (e: React.MouseEvent, address: string) => {
    e.stopPropagation()
    removeToken(address)
  }

  const displayTokens = searchQuery ? searchResults : defaultTokens
  const isExternalSearch = !!searchQuery && searchResults.length > 0

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[86vh] max-w-xl overflow-hidden border-border bg-card p-0">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="flex h-full max-h-[86vh] flex-col"
        >
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>Select a token</DialogTitle>
            <DialogDescription>
              Search by symbol, name, or paste a contract address.
            </DialogDescription>
          </DialogHeader>

          {isExternalSearch && (
            <div className="mx-5 mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              External search results are unverified. Confirm token details before importing.
            </div>
          )}

          <div className="px-5 py-4">
            <Input
              placeholder="Search name or paste address"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {loading ? (
              <div className="rounded-md border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                Loading tokens...
              </div>
            ) : (
              <div className="space-y-1">
                {displayTokens.map((token) => {
                  const logo = token.logoURI || getTokenLogo(token.symbol)
                  return (
                    <button
                      key={token.address}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/40"
                      onClick={() => onSelect(token)}
                    >
                      {logo ? (
                        <img src={logo} alt={token.symbol} className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {token.symbol[0]}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{token.symbol}</p>
                        <p className="truncate text-xs text-muted-foreground">{token.name}</p>
                      </div>

                      {token.isImported && (
                        <>
                          <Badge variant="warning">Imported</Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => handleRemoveImported(e, token.address)}
                            aria-label={`Remove ${token.symbol}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </button>
                  )
                })}

                {searchQuery && !loading && displayTokens.length === 0 && (
                  <div className="rounded-md border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
                    No tokens found.
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
