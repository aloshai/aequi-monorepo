import { useState, useEffect } from 'react'
import { searchTokens } from '../services/dexscreener'
import type { Token } from '../services/token-manager'
import { tokenManager } from '../services/token-manager'
import { getTokenLogo } from '../utils/logos'

interface TokenModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (token: Token) => void
  defaultTokens: Token[]
}

export function TokenModal({ isOpen, onClose, onSelect, defaultTokens }: TokenModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Token[]>([])
  const [loading, setLoading] = useState(false)
  const [, forceUpdate] = useState(0)

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
        const results = await searchTokens(searchQuery)
        setSearchResults(results)
      } catch (error) {
        console.error('Search failed', error)
      } finally {
        setLoading(false)
      }
    }

    const debounce = setTimeout(search, 500)
    return () => clearTimeout(debounce)
  }, [searchQuery])

  const handleRemoveImported = (e: React.MouseEvent, address: string) => {
    e.stopPropagation()
    tokenManager.removeImportedToken(address)
    forceUpdate((n) => n + 1)
  }

  if (!isOpen) return null

  const displayTokens = searchQuery ? searchResults : defaultTokens

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Select a token</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="search-container">
          <input
            className="search-input"
            placeholder="Search name or paste address"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="token-list">
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading...
            </div>
          ) : (
            displayTokens.map((token) => (
              <div
                key={token.address}
                className="token-item"
                onClick={() => onSelect(token)}
              >
                {token.logoURI || getTokenLogo(token.symbol) ? (
                  <img src={token.logoURI || getTokenLogo(token.symbol)} alt={token.symbol} className="token-icon" />
                ) : (
                  <div className="token-icon">{token.symbol[0]}</div>
                )}
                <div className="token-info">
                  <span className="token-symbol">{token.symbol}</span>
                  <span className="token-name">{token.name}</span>
                </div>
                {token.isImported && (
                  <>
                    <span className="import-badge">Imported</span>
                    <button
                      className="remove-token-btn"
                      onClick={(e) => handleRemoveImported(e, token.address)}
                      title="Remove imported token"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '14px', padding: '4px', marginLeft: '4px' }}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            ))
          )}

          {searchQuery && !loading && displayTokens.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No tokens found
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
