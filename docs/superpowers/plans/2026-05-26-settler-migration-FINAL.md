# 0x Settler Migration — Final State

**Branch:** `feat/settler-migration`
**Date:** 2026-05-26
**Spec:** `docs/superpowers/specs/2026-05-26-settler-migration-design.md`

## What is in this branch

All swaps route through 0x Settler. AequiExecutor is removed completely. Both `settler-allowance-holder` and `settler-permit2` token-flow modes work end-to-end.

### Migration complete

- ✅ 0x Settler vendored as submodule (MIT, upstream master)
- ✅ Canonical Settler / SettlerMetaTxn / AllowanceHolder / Permit2 addresses hardcoded for ETH + BSC (resolved via `Deployer.ownerOf(tokenId)` against live RPC)
- ✅ `ExecutorBackend` interface + `SettlerBackend` implementation covering:
  - AllowanceHolder mode: `AllowanceHolder.exec(operator=Settler, …)` wrapping `Settler.execute(slippage, actions, zid)`
  - Permit2 mode: `SettlerMetaTxn.executeMetaTxn(slippage, actions, zid, msgSender, sig)` with EIP-712 typed-data witness `SlippageAndActions(recipient, buyToken, minAmountOut, actions)`
  - Single-hop + multi-hop V2 (Uniswap V2 / PancakeSwap V2 / V2 forks)
  - Single-hop + multi-hop V3 with Settler's enhanced 64-byte-per-hop path layout (forkId mapping: uniswap=0, pancake=1, sushiswap=2)
  - Split routes with `bps` scaled relative to remaining input
  - Native input via `BASIC → WETH.deposit{value: amount}()`
  - Native output via `BASIC → WETH.withdraw(amount-injected-via-offset)`
  - Fee skim via `POSITIVE_SLIPPAGE` (active only when `FEE_RECIPIENT` env is set)
  - Typed errors for unsupported chains / native-input-on-Permit2 / unknown DEXes
- ✅ Server `/swap` controller dispatches on `tokenFlow ∈ {settler-allowance-holder, settler-permit2}`. AequiExecutor code path is gone.
- ✅ Frontend `useSwapExecution`:
  - AllowanceHolder mode: server returns final calldata; existing approve flow targets AllowanceHolder.
  - Permit2 mode: server returns EIP-712 typed data; frontend calls wagmi `signTypedData`, re-encodes `executeMetaTxn` with `SETTLER_META_TXN_ABI` from `@aequi/core`, then sends the tx. The one-time ERC20 approval targets the canonical Permit2 contract.
- ✅ `SettingsModal` exposes a "Token Flow" selector with both modes enabled.
- ✅ AequiExecutor removed in full:
  - `packages/contracts/contracts/AequiExecutor.sol` deleted
  - `packages/contracts/test/AequiExecutor.js` deleted
  - `packages/contracts/ignition/modules/AequiExecutor.js` deleted
  - `packages/contracts/ignition/deployments/chain-24101/` deleted (was AequiExecutor-only)
  - `packages/core/src/swap-builder.ts` + its tests deleted
  - `AEQUI_EXECUTOR_ABI`, `V2_ROUTER_ABI`, `V3_ROUTER_ABI`, `V3_ROUTER02_ABI` removed from `core/abi.ts`
  - `AEQUI_EXECUTOR_*` env vars removed from server schema + `.env.example`
  - `appConfig.executor` removed; `appConfig.fee` gained `recipient`

### Test status

```
@aequi/core:test       24 passed (24)
@aequi/pricing:test    98 passed (98)
@aequi/server:test     34 passed (34)
──────────────────────────────────
                      156 unit tests passing
                      + 8 real-RPC fork sims (BSC AH x4, ETH AH x3, BSC Permit2 x1)
check-types            7/7 packages ✓
```

Real-RPC fork sims (executed against `bsc-dataseed.binance.org` + `ethereum-rpc.publicnode.com`):
- ✓ AllowanceHolder + Settler + SettlerMetaTxn bytecode is present on BSC
- ✓ ETH Settler + SettlerMetaTxn bytecode is present
- ✓ BSC single-hop V2 (WBNB→BUSD via PancakeSwap V2): calldata reaches Settler's slippage check
- ✓ ETH single-hop V3 (WETH→USDC via Uniswap V3 500bps): calldata reaches Settler's internal validators
- ✓ BSC Permit2 single-hop V2: throwaway-keyed signature is generated, calldata is re-encoded with the real sig, eth_call dispatches into SettlerMetaTxn's internal validators

### Deployment

- **Production environment** (`production`, `aloshai/aequi-monorepo:main`): unchanged.
- **Staging environment** (NEW, `staging-settler`, `aloshai/aequi-monorepo:feat/settler-migration`):
  - Dokploy project ID: `U1QHclsMWNQdqIGBbEt7s` (Aequi)
  - Environment ID: `RP_ZO5CUc_D2bapdqz5re`
  - Compose service ID: `whduOtYMKw4VdTnt6LouU` (`aequi-settler-staging`)
  - Subdomains: `settler.alosha.me` (web), `settler-api.alosha.me` (api).
    (NOTE: original `*-staging.alosha.me` subdomains hit a Cloudflare
    redirect rule and were swapped to plain `settler*` to avoid it.)
  - Container names: `aequi-server-settler` + `aequi-web-settler`
    (parameterised via `STACK_SUFFIX` in docker-compose; production
    uses `${STACK_SUFFIX:-prod}` → `aequi-server-prod`, etc.).
  - Auto-deploy on push to `feat/settler-migration`.
  - Deploy succeeds end-to-end; containers running on `dokploy-network`,
    Traefik routes via STACK_SUFFIX-qualified router names.

### What was kept

- AequiLens (`packages/contracts/contracts/AequiLens.sol`) — unrelated to execution; still used by pool discovery via multicall.
- Pricing layer (`packages/pricing`) — quote math, route planning, pool discovery — unchanged.
- DEX adapters (`packages/dex-adapters`) — quote-side adapters unchanged.

### Deferred (explicit)

- **Incentiv Settler deployment** — Settler is not deployed on Incentiv. Choosing any swap on Incentiv now throws `INVALID_CHAIN` from `SettlerBackend.resolveSettlerAddress`. To unblock:
  1. Fork `0x-settler` upstream and add an Incentiv chain definition (`src/chains/Incentiv/{Common,TakerSubmitted,MetaTxn}.sol`).
  2. Run `BROADCAST=yes ./sh/deploy_new_chain.sh Incentiv` from a Linux/macOS host (Windows MAX_PATH breaks the deep submodule init).
  3. Update `appConfig.settler.byChain.incentiv.{settler,settlerMetaTxn}` with the deployed addresses.
- **Uniswap V4** — not on this branch. Add a V4 adapter to `@aequi/dex-adapters` and a `UNISWAPV4` action encoder to `SettlerBackend` to enable.

### Required follow-ups before flipping production traffic

1. Smoke-test staging at `aequi-staging.alosha.me`: WBNB→BUSD on BSC, WETH→USDC on ETH, both AllowanceHolder and Permit2 modes.
2. Verify Permit2 signing flow with a real wallet (MetaMask et al.).
3. Set `FEE_RECIPIENT` env if fee skim is desired (defaults to off).
4. Quarterly: re-resolve canonical Settler addresses via `Deployer.ownerOf(2|3)` and update `app-config.ts`. 0x deploys new Settler versions periodically.
5. Merge `feat/settler-migration` → `main` to roll into production.
