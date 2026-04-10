# Project Guidelines

## Code Style

- Keep all token, gas, reserve, and quote amounts as `bigint`. Never use `number` for on-chain amounts.
- Price math uses Q18 fixed point (`10n ** 18n`). Reuse helpers in `packages/pricing/src/math.ts`.
- Normalize addresses with `viem` `getAddress()` and compare in lowercase when needed.
- Reuse shared types from `@aequi/core` (`apps/server/src/types.ts` re-exports these); do not redefine local duplicates.
- Use `AequiError` and stable `ErrorCode` values from `packages/core/src/errors.ts` for structured API failures.

## Architecture

Turbo monorepo with Bun workspaces:

- `apps/server`: Fastify API. Route modules in `src/routes/*.ts` call controller handlers in `src/controllers/*.ts`; dependencies are composed in `src/deps.ts`.
- `apps/web`: React 19 + Vite client using Wagmi and Axios.
- `packages/core`: shared types, errors, ABIs, and `SwapBuilder`.
- `packages/pricing`: token metadata, pool discovery, routing, quote math, split optimization.
- `packages/dex-adapters`: Uniswap/Pancake adapters registered through pricing registry.
- `packages/contracts`: Hardhat contracts (`AequiExecutor`, `AequiLens`).

Server flow (high level): validate request -> resolve chain -> fetch metadata/pools -> score routes -> cache/store quote -> build swap calldata.

## Build and Test

Run from repo root unless noted:

- `bun install`
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run check-types`
- `npm run test`

Area-specific commands:

- `cd apps/server && bun run index.ts`
- `cd apps/web && bun run dev`
- `cd packages/core && npx vitest`
- `cd packages/pricing && npx vitest`
- `cd packages/contracts && npx hardhat compile`
- `cd packages/contracts && npx hardhat test`

## Conventions

- Route preference is `'auto' | 'v2' | 'v3'`; auto prefers V3 then falls back to V2.
- Native token sentinel is `0xEeeeeEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`.
- DEX adapters are keyed by `${protocol}-${version}` and must be registered before pricing logic runs.
- Fastify logger is disabled in tests (`NODE_ENV=test`).
- Keep chain/DEX config in `apps/server/src/config/chains.ts` and env parsing/defaults in `apps/server/src/config/app-config.ts`.

## Pitfalls

- Server startup requires at least one RPC URL (`RPC_URL_ETH` or `BSC_RPC_URL`) to pass env validation.
- Ethereum executor address has no default; ensure `AEQUI_EXECUTOR_ETH` is configured when Ethereum swaps are expected.
- Quote TTL defaults are short; stale quote IDs can expire quickly in `/swap` flows.
- `apps/server` currently has no real lint task (`lint` script is a placeholder echo).

## Reference Docs

- Overview and workspace scripts: [README.md](../README.md)
- Server API and internals: [apps/server/README.md](../apps/server/README.md)
- Frontend behavior: [apps/web/README.md](../apps/web/README.md)
- Shared types/errors/swap builder: [packages/core/README.md](../packages/core/README.md)
- Pricing and routing details: [packages/pricing/README.md](../packages/pricing/README.md)
- Adapter implementation patterns: [packages/dex-adapters/README.md](../packages/dex-adapters/README.md)
- Smart contract workflow: [packages/contracts/README.md](../packages/contracts/README.md)

