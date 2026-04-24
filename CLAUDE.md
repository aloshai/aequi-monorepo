# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Aequi is a DEX aggregator for Ethereum, BSC, and Incentiv. It discovers Uniswap/PancakeSwap V2+V3 liquidity pools, scores routes, and executes atomic swaps through a custom on-chain executor contract.

## Build & Dev Commands

Package manager is **Bun**. Task orchestration via **Turbo**. Run from repo root:

```
bun install                # install all workspace deps
npm run build              # build all packages then apps (turbo)
npm run dev                # dev servers: Fastify (3000) + Vite (5173)
npm run test               # vitest across all packages
npm run check-types        # tsc --noEmit everywhere
npm run lint               # lint (note: server lint is a placeholder)
npm run format             # prettier
```

Per-package:

```
cd apps/server && bun run index.ts        # start server standalone
cd apps/web && bun run dev                # vite dev server
cd packages/core && npx vitest            # core unit tests
cd packages/pricing && npx vitest         # pricing unit tests
cd packages/contracts && npx hardhat test # solidity tests
cd packages/contracts && npx hardhat compile
```

Single test file: `cd packages/<pkg> && npx vitest run src/__tests__/file.test.ts`

## Architecture

Turbo monorepo with Bun workspaces (`apps/*`, `packages/*`).

### Dependency graph

```
apps/server ──> @aequi/core, @aequi/pricing, @aequi/dex-adapters
apps/web    ──> (standalone, calls server via HTTP)
packages/pricing ──> @aequi/core
packages/dex-adapters ──> @aequi/core, @aequi/pricing
packages/contracts ──> (standalone Hardhat project)
```

### Server (`apps/server`)

Fastify REST API. Request flow: route (`src/routes/`) -> controller (`src/controllers/`) -> service (`src/services/`). Dependencies composed via `src/deps.ts` (DI pattern). Chain clients with fallback RPC in `src/services/clients/`.

Key API routes: `/price`, `/quote`, `/swap`, `/exchange`, `/token`, `/allowance`, `/approve`, `/health`.

### Web (`apps/web`)

React 19 + Vite + Wagmi + Zustand. State in `src/store/`, API calls in `src/services/aequi-api.ts`, swap execution in `src/hooks/use-swap-execution.ts`.

### Core (`packages/core`)

Shared types (`ChainKey`, `PriceQuote`, `QuoteResult`, `TokenMetadata`), error hierarchy (`AequiError` + `ErrorCode`), contract ABIs, and `SwapBuilder` (converts quotes into AequiExecutor calldata).

### Pricing (`packages/pricing`)

Pool discovery (via AequiLens multicall), route planning, V2/V3 quote math, split route optimization. Q18 fixed-point math helpers in `src/math.ts`.

### DEX Adapters (`packages/dex-adapters`)

Uniswap V2/V3, PancakeSwap V2/V3, Incentiv V3. Registered into a global registry via `registerDefaultAdapters()`. Keyed by `${protocol}-${version}`.

### Contracts (`packages/contracts`)

Solidity 0.8.28 (Hardhat, optimizer 200 runs). **AequiExecutor**: stateless atomic multicall (pull tokens -> approve -> execute -> revoke -> flush). **AequiLens**: batch pool data queries. Deploy with Hardhat Ignition.

## Code Conventions

- All on-chain amounts are `bigint`, never `number`.
- Price math uses Q18 fixed point (`10n ** 18n`). Reuse `packages/pricing/src/math.ts`.
- Normalize addresses with viem `getAddress()`; compare in lowercase.
- Use shared types from `@aequi/core` — don't redefine locally.
- Use `AequiError` subclasses with stable `ErrorCode` values for structured failures.
- Native token sentinel: `0xEeeeeEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`.
- Route preference: `'auto' | 'v2' | 'v3'` — auto prefers V3, falls back to V2.
- Fastify logger is disabled when `NODE_ENV=test`.

## Environment

Copy `.env.example` to `.env`. Key requirements:
- At least one RPC URL (`RPC_URL_ETH` or `BSC_RPC_URL`) must be set for server startup.
- `AEQUI_EXECUTOR_ETH` has **no default** — must be configured for Ethereum swaps.
- `AEQUI_EXECUTOR_BSC` defaults to `0x03cbBc27784c64FC4A6f11eFe8D1C3b4Dee204EA`.
- `VITE_API_BASE_URL` defaults to `http://localhost:3000` for the web app.
