/**
 * Aequi logomark — a monoline "equilibrium" mark: two strokes meeting at a
 * balanced midline (evokes aequus = equal/fair, and best-execution balance).
 * Inherits currentColor; pair with the gradient wordmark.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id="aequi-mark" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="hsl(245 70% 60%)" />
          <stop offset="1" stopColor="hsl(258 80% 66%)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#aequi-mark)" opacity="0.12" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" stroke="url(#aequi-mark)" strokeOpacity="0.5" />
      {/* two converging bars + balanced midline */}
      <path d="M9 12.5 L23 12.5" stroke="url(#aequi-mark)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 19.5 L23 19.5" stroke="url(#aequi-mark)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.7" fill="url(#aequi-mark)" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`font-display font-bold tracking-tight ${className ?? ''}`}>Aequi</span>
  )
}
