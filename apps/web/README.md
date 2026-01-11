# Aequi Web Interface

> ⚠️ Work in progress: UI/API may change; not production-ready.

React/Vite frontend for the Aequi DEX aggregator. Talks to the Fastify API to fetch prices/quotes and builds swaps, with Wagmi for wallet connectivity.

## Features
- Swap flow with confirmation modal showing route details and gas estimates
- Token search/import with server `/token` endpoint and local persistence
- Real-time wallet balance display for selected tokens
- Route analysis with multi-hop visualization and comparison table
- Settings for slippage and deadline configuration
- Wagmi + `viem` for Ethereum and BSC

## Stack
- React 19, Vite 7, TypeScript.
- Wagmi + `viem` for wallet/RPC.
- Axios HTTP client (see `src/lib/http.ts`).

## Environment
- `VITE_API_BASE_URL` – server base URL (defaults to `http://localhost:3000`).

## Run locally
```bash
# install at repo root
bun install

# start dev server
cd apps/web
bun run dev
# opens on http://localhost:5173
```

## Scripts
- `bun run dev` – Vite dev server.
- `bun run build` – type-check + production build.
- `bun run lint` – ESLint.
- `bun run preview` – preview production build.
