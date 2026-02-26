# Aequi Monorepo AI Instructions

## Architecture

Turbo monorepo (Bun package manager) — a DEX aggregator for Ethereum and BSC where all swaps funnel through the on-chain `AequiExecutor` contract for atomic execution.

| Layer | Path | Role |
|---|---|---|
| Server | `apps/server` | Fastify API — discovers pools, prices routes, returns quotes, builds calldata |
| Web | `apps/web` | React 19 / Vite frontend — Wagmi wallet, swap UI, route visualization |
| Core | `packages/core` | Shared types (`ChainKey`, `PriceQuote`, `QuoteResult`), ABIs, `SwapBuilder`, `AequiError` hierarchy |
| Pricing | `packages/pricing` | `TokenService`, `PoolDiscovery`, `PriceService`, quote math, split optimizer, DEX adapter registry |
| DEX Adapters | `packages/dex-adapters` | Uniswap/PancakeSwap V2+V3 adapter implementations; `registerDefaultAdapters()` must run before pricing |
| Contracts | `packages/contracts` | Hardhat — `AequiExecutor.sol` (multicall executor) + `AequiLens.sol` (batch pool data) |

## Data flow (server)

`apps/server/src/index.ts` (single-file route handler, no controller layer):
1. Zod validates request → `resolveChain()` picks `ChainConfig` from `config/chains.ts`
2. `TokenService` resolves metadata (cached 5 min) → `PoolDiscovery` finds pools via multicall + AequiLens
3. `PriceService.getBestQuoteForTokens()` scores routes by net output (amount − gas) with optional split routing
4. `/quote` stores result in `QuoteStore` (TTL-based) → returns `quoteId` + `expiresAt`
5. `/swap` consumes stored quote (or fetches fresh), calls `SwapBuilder.build()` → returns calldata + gas estimate via RPC simulation with state overrides

## Key conventions

- **All amounts are `bigint`**; prices use Q18 fixed-point (1.0 = `10n ** 18n`). Never use `number` for token/gas amounts.
- **Addresses**: normalize with `viem` `getAddress()`, then lowercase for comparisons. Native token sentinel: `0xEeeeeEeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`.
- **Error handling**: Use `AequiError` subclasses from `packages/core/src/errors.ts` with stable `ErrorCode` enum values (e.g., `invalid_request`, `no_route_found`, `quote_expired`). Server error handler in `middleware/error-handler.ts` converts all errors to JSON with `{ error, message, statusCode, retryable }`.
- **Route preference**: `'auto' | 'v2' | 'v3'` — auto tries V3 first, falls back to V2.
- **Server types**: `apps/server/src/types.ts` re-exports from `@aequi/core` — don't duplicate types.
- **Config**: env parsing in `config/app-config.ts` (with defaults), chain/DEX registry in `config/chains.ts`, intermediate tokens + executor map in `config/constants.ts`.
- **DEX adapters**: Extend `BaseDexAdapter` from `@aequi/pricing`, register via `dexRegistry.register()`. Adapters are keyed by `"${protocol}-${version}"` (e.g., `"uniswap-v3"`).
- **Fastify logger** disabled when `NODE_ENV=test`.

## Workflows

```sh
bun install                            # install deps (workspace root)
npm run dev                            # turbo dev — all apps hot-reload
cd apps/server && bun run index.ts     # server only (0.0.0.0:3000)
cd apps/web && bun run dev             # web only (localhost:5173)
npm run lint && npm run check-types    # CI checks (turbo-orchestrated, depend on ^build)
npm run build                          # production build all
```

**Tests**: Vitest with `globals: true`. Tests live in `__tests__/` dirs. Run per-package: `cd packages/core && npx vitest` or `cd packages/pricing && npx vitest`.

**Contracts**: From `packages/contracts` — `npx hardhat compile`, `npx hardhat test`, deploy via `npx hardhat ignition deploy ignition/modules/AequiExecutor.js --network <name>`.

## API surface

`GET /health[/live|/ready]`, `GET /exchange`, `GET /token`, `GET /allowance`, `POST /approve`, `GET /price`, `GET /quote`, `POST /swap` — all accept `chain` param. `/swap` returns calldata + block metadata + `simulationPassed` flag.

## Frontend patterns

- Axios client with `VITE_API_BASE_URL` in `apps/web/src/lib/http.ts`; all API calls centralized in `services/aequi-api.ts`.
- Wagmi config in `lib/wagmi.ts` (mainnet + BSC, MetaMask + injected connectors).
- Custom tokens persisted via `TokenManager` singleton (localStorage key: `aequi_imported_tokens`).
- `App.tsx` is the main swap form — single-component state machine, no router.

## Extending chains/DEXes

1. Add `ChainConfig` entry in `apps/server/src/config/chains.ts` with DEX configs (factory, router, quoter, fee tiers, `useRouter02` flag).
2. Add intermediate tokens + executor address in `config/constants.ts`.
3. Add RPC env vars in `config/app-config.ts`.
4. If new protocol: create adapter in `packages/dex-adapters`, extend `BaseDexAdapter`, register in `registerDefaultAdapters()`.
5. Update `ChainKey` union in `packages/core/src/types.ts`.
6. Add chain to `wagmiConfig` transports and `CHAIN_BY_KEY` in `apps/web/src/lib/wagmi.ts`.

