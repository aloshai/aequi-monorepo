# Aequi Redesign — Refined Fintech (Linear/Stripe), Dual-Theme

**Date:** 2026-06-04
**Direction (user-approved):** Linear/Stripe "refined fintech" — calm, premium, precise, restraint over density. NOT the neon trading-terminal look of the prior pass.
**Theme:** Both light + dark. **Default light.** Toggle in navbar, persisted.
**Scope:** New brand identity + marketing landing page (`/`) + full trade panel rework (`/app`) + motion. Swap logic (wagmi, stores, hooks, API) preserved unchanged — only the visual/structure layer changes.

## Pain points being fixed (all four, user-stated)
1. Identityless/generic → distinct brand (mark, wordmark, voice, one refined accent).
2. No landing/hero → real marketing landing.
3. Amateur trade panel → refined, hierarchical swap + insights.
4. Lifeless/static → tasteful motion (staggered reveals, hover, number transitions, hero gradient drift).

## Brand
- **Concept:** Aequi = Latin *aequus* "equal/fair". Story = fair price, proven best execution. Tagline: **"Fair price, found."**
- **Logomark:** monoline geometric equilibrium mark (two converging strokes / "=" derived), replaces the generic gradient "A" square.
- **Voice:** precise, confident, quiet. No hype.

## Design system
### Typography
- **Geist** (400–700) for display + body; **Geist Mono** for all numerals (tabular). Drop Bricolage Grotesque. One family, restraint = refinement.

### Color (one accent, refined indigo→violet — NOT neon cyan)
Light (default, Stripe-leaning):
- bg `#fbfbfd` + subtle top gradient mesh; card `#ffffff`; well `#f5f6f8`; border `#e8eaed` (hairline)
- text `#16181d` / `#5b6472` / `#8a909c`
- accent `#5b5bd6`→`#7c5cff`; positive `#1a9d6b`; soft layered shadows

Dark (Linear-leaning):
- bg `#0b0c0e`; card `#141519`; well/elevated `#1a1c21`; border `rgba(255,255,255,0.08)`
- text `#e9eaed` / `#a0a6b0` / `#6e7480`
- accent `#6e6ef5`→`#8b7cff`; positive `#22a06b`

### Theming mechanism
- Tailwind already `darkMode:['class']`. Define light tokens on `:root`, dark on `.dark`, for BOTH token systems (shadcn HSL in `styles/tailwind.css` + bespoke `--bg-*`/`--text-*` in `index.css`).
- `useThemeStore` (zustand + persist), default `'light'`, applies/removes `.dark` on `<html>`. Sun/moon toggle in navbar.

### Motion (Framer Motion, already a dep)
- Page-load staggered fade+rise; hero gradient slow drift; refined quick hover states; quote number transitions; smooth route reveal. Subtle, never bouncy.

## Routing
- Add `react-router-dom`. `/` = landing, `/app` = trade panel. Shared layout (nav + footer). Wallet/chain state lifts to a provider so both routes share it.

## Landing (`/`)
1. Hero: refined headline ("Fair price, found."), subhead, **Launch app** CTA, tasteful visual centerpiece (floating live-quote card / abstract equilibrium-route visual), glassy nav.
2. Trust strip: ETH · BSC · Ink · "powered by 0x Settler".
3. Feature trio: Best execution (split + multi-hop) · Wide coverage (V2/V3/V4 · Velodrome) · Non-custodial (Settler, audited).
4. How it works: connect → quote → swap.
5. Closing CTA + footer (retains required PoweredBy attribution).

## Trade panel (`/app`) rework
- Refined swap card (cleaner sell/buy fields, better token selector), calm hierarchical quote insights (not dense terminal), elegant route visualization, premium loading/empty states. All existing functionality preserved (slippage, settings, token modal, lifecycle, confirm modal, approval/Permit-disabled flow).

## Out of scope
- No swap-logic changes. No new chains/DEXes. Permit2 stays disabled (relayer). No backend changes.

## Validation
- `npm run check-types` + `npm run test` green.
- Visual gut-check on the landing hero + trade panel (real render) BEFORE polishing everything, per user's request to see-and-approve early.
- Both themes verified; default light on first load.
