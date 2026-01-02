# Aequi Monorepo AI Instructions

- What this is: Turbo-managed mono repo with Fastify/TypeScript backend, React/Vite frontend, and Hardhat contracts for the Aequi DEX aggregator. Focus on routing across Uniswap/Pancake (V2/V3) on Ethereum and BSC.

## Architecture
- Server flow: HTTP handlers in [apps/server/src/index.ts](apps/server/src/index.ts) normalize inputs (Zod + `viem` address checks), resolve chain config, fetch token metadata via `TokenService`, price via `PriceService`, and assemble quotes via `QuoteService`; swaps are built by `SwapBuilder` then returned as calldata + metadata.
- Routes: `/exchange`, `/token`, `/allowance`, `/approve`, `/price`, `/quote`, `/swap` are implemented end-to-end in [apps/server/src/index.ts](apps/server/src/index.ts) including slippage/defaults, TTL, and quote expiration details.
- Chain config: [apps/server/src/config/chains.ts](apps/server/src/config/chains.ts) enumerates supported chains, DEX routers/factories, fee tiers, and RPC lists derived from [apps/server/src/config/app-config.ts](apps/server/src/config/app-config.ts); BSC executor defaults exist even if env is missing.
- RPC selection: [apps/server/src/services/rpc/rpc-registry.ts](apps/server/src/services/rpc/rpc-registry.ts) merges configured URLs with Chainlist, probes latency/rate-limit headers, caches rankings, and falls back to degraded endpoints.
- Pricing/quotes: Mid/exec price math and impact/fee adjustments live in [apps/server/src/services/price/quote-math.ts](apps/server/src/services/price/quote-math.ts); uses Uniswap/Pancake SDK Core for quote math; intermediate tokens and thresholds defined in [apps/server/src/config/constants.ts](apps/server/src/config/constants.ts).
- Swap building: [apps/server/src/services/transactions/swap-builder.ts](apps/server/src/services/transactions/swap-builder.ts) chooses direct router call when single DEX; multi-hop builds AequiExecutor calldata. Adds inter-hop buffer (configurable BPS), per-hop approvals with auto-revoke, hop-level minOut scaling, and encodes V2/V3 paths.
- Contracts: [packages/contracts/contracts/AequiExecutor.sol](packages/contracts/contracts/AequiExecutor.sol) performs pulls -> approvals -> arbitrary calls -> revoke approvals -> flush ERC20/native to recipient; non-reentrant guard and failure bubbling on token/call errors.
- Web: API wrapper in [apps/web/src/services/aequi-api.ts](apps/web/src/services/aequi-api.ts) mirrors server routes; `wagmi` config targets mainnet+BSC in [apps/web/src/lib/wagmi.ts](apps/web/src/lib/wagmi.ts); user-imported tokens persisted via [apps/web/src/services/token-manager.ts](apps/web/src/services/token-manager.ts).

## Conventions
- Amounts/fees as `bigint`; conversions handled by utils in `apps/server/src/utils/units.ts` and `utils/trading.ts` (slippage clamping, address normalization). Avoid `number` for token amounts.
- Route preference accepts `auto|v2|v3`; `auto` can mix hops but V3 calldata requires homogeneous V3 hops.
- Executor address keyed per chain via env (`AEQUI_EXECUTOR_ETH`, `AEQUI_EXECUTOR_BSC`) with defaults; slippage/TTL/buffer derive from env with sane minimums in [apps/server/src/config/app-config.ts](apps/server/src/config/app-config.ts).
- Intermediate tokens for routing are curated per chain in [apps/server/src/config/constants.ts](apps/server/src/config/constants.ts); quote selection compares by amountOut then liquidity score then price impact.
- Keep logging minimal; Fastify logger toggled by env, rate limits configurable; error responses use `error` codes (`invalid_request`, `unsupported_chain`, etc.).

## Workflows
- Install: `bun install` or `npm install` at repo root (Bun preferred in docs).
- Dev: `npm run dev` (Turbo) or `bun run dev` per app (see app READMEs). Server defaults to port 3000; web to 5173.
- Build: `npx turbo build` from root.
- Contracts: in `packages/contracts` use `npx hardhat compile|test`; deploy via `npx hardhat ignition deploy ignition/modules/AequiExecutor.js --network <name>`.

## When coding
- Prefer `viem` for chain calls; do not introduce `ethers` unless justified.
- Respect BigInt-safe arithmetic and slippage/TTL clamps; reuse existing math/encoding helpers instead of reimplementing.
- If adding chains/DEXes, update chain config, executor address map, intermediate tokens, and fee tiers together; ensure RPC registry can supply URLs.
- Frontend should call existing API client helpers rather than constructing URLs manually; keep chain keys aligned with server `ChainKey`.
