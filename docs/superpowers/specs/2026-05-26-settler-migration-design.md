# Settler Migration Design

**Date:** 2026-05-26
**Status:** Draft, awaiting user review
**Scope:** Replace AequiExecutor with 0x Settler across all chains, add Uniswap V4 support.

## 1. Motivation

AequiExecutor is a custom, generic multicall contract: every DEX integration must be hand-encoded in `packages/core/swap-builder.ts`. 0x Settler is a maintained, gas-optimized settlement contract with native support for a wide range of DEX protocols (Uniswap V2/V3/V4, PancakeSwap, Curve, Balancer, Maverick, Dodo, etc.) and modern token flow primitives (Permit2, AllowanceHolder). Migrating to Settler:

- Removes the maintenance burden of AequiExecutor (~600 LoC Solidity + tests).
- Adds Uniswap V4 support as part of the migration.
- Establishes a foundation for future DEX additions without contract changes.

0x Settler is **MIT-licensed**, so vendoring it as a dependency does not impose copyleft obligations on Aequi — the project remains Apache-2.0. (An earlier assumption that Settler was AGPL turned out to be incorrect.)

## 2. Fixed Decisions

| Decision | Choice |
|---|---|
| Token flow | Both AllowanceHolder and Permit2 (user-selectable, AllowanceHolder default) |
| Incentiv chain | Deploy a self-maintained Settler fork on Incentiv |
| Rollout | Big-bang (no parallel paths, no feature flag) |
| DEX scope | Existing DEXes (V2, V3, Pancake V2/V3, Incentiv V3) + Uniswap V4 |
| V4 hooks | Only `hooks=address(0)` pools in this migration |
| Chain coverage | Ethereum, BSC, Incentiv (no new chains in this migration) |
| AequiExecutor | Deleted entirely |
| AequiLens | Kept (independent of execution path) |
| Pricing layer | Kept; extended with V4 discovery + quote |
| Backend abstraction | `ExecutorBackend` interface with single `SettlerBackend` impl |

## 3. Architecture

```
                 ┌─────────────────────────────────────────┐
                 │           apps/web (React)              │
                 │  TokenFlow: AllowanceHolder | Permit2   │
                 └────────────────┬────────────────────────┘
                                  │  HTTP
                 ┌────────────────▼────────────────────────┐
                 │         apps/server (Fastify)           │
                 │  /quote → pricing layer                 │
                 │  /swap  → SwapBuilder → ExecutorBackend │
                 │                       └→ SettlerBackend │
                 └────────────────┬────────────────────────┘
                                  │
        ┌─────────────────────────┴────────────┐
        │                                      │
┌───────▼────────┐                  ┌──────────▼───────┐
│ @aequi/pricing │                  │ @aequi/          │
│ - Discovery    │                  │  dex-adapters    │
│   (V2/V3/V4)   │                  │ Adapter pairs:   │
│ - RoutePlanner │                  │  V2  + V2Encoder │
│ - Quote math   │                  │  V3  + V3Encoder │
│                │                  │  V4  + V4Encoder │
└────────────────┘                  │  Pancake V2/V3   │
                                    │  Incentiv V3     │
                                    └──────────────────┘

On-chain:
- Settler (per chain — 0x deployment, or self-deployed on Incentiv)
- AllowanceHolder (per chain)
- Permit2 (canonical 0x000000000022D473030F116dDEE9F6B43aC78BA3)
- AequiLens (kept — pool data multicall)
```

Key principles:

- `SwapBuilder` becomes an orchestrator: takes a `PriceQuote` + `SwapBuildParams`, calls `ExecutorBackend.build()`, returns a `SwapTransaction`. It does not know ABIs.
- `ExecutorBackend` is a single-method interface: `build(plan: SwapPlan): SwapTransaction`. Currently one impl (`SettlerBackend`); the abstraction exists so future executor changes (e.g., UniversalRouter) do not require rewriting the builder.
- Each DEX adapter in `@aequi/dex-adapters` is paired with an `ActionEncoder` that produces a `SettlerAction = { selector: bytes4, data: bytes }`. Quote logic and execute logic live next to each other.
- AequiExecutor is removed in full. AequiLens stays — it is pool-data multicall, unrelated to execution.

## 4. Components (per-package changes)

### `packages/core`

| Action | File | Notes |
|---|---|---|
| New | `src/executor-backend.ts` | `ExecutorBackend` interface, `SwapPlan` type, `SwapTransaction` shape (new). |
| New | `src/settler-backend.ts` | `SettlerBackend implements ExecutorBackend`. Chain-aware address selection. Builds action lists, fee skim, native wrap/unwrap, slippage guards. |
| New | `src/settler-types.ts` | Settler action selectors (`bytes4` consts), `SettlerAction` type, Permit2 EIP-712 types. |
| New | `src/settler-errors.ts` | Maps known Settler revert selectors to `ErrorCode`. |
| Modified | `src/swap-builder.ts` | Reduced to orchestration. No ABI knowledge. Delegates to `ExecutorBackend`. |
| Modified | `src/abi.ts` | Remove `AEQUI_EXECUTOR_ABI`, `V2_ROUTER_ABI`, `V3_ROUTER_ABI`, `V3_ROUTER02_ABI`. Add `SETTLER_ABI`, `ALLOWANCE_HOLDER_ABI`, `PERMIT2_ABI`. Keep `WETH_ABI` (still used). |
| Modified | `src/types.ts` | `SwapTransaction.kind` → `'settler-allowance-holder' \| 'settler-permit2'`. Drop `executor.{pulls,approvals,calls,tokensToFlush}`. Add optional `permit2: { domain, types, message }`. |
| Modified | `src/errors.ts` | New `ErrorCode` values (see §6). |

### `packages/dex-adapters`

| Action | File | Notes |
|---|---|---|
| New | `src/uniswap-v2/encoder.ts` | `UNISWAP_V2` selector encoding. Handles FoT variant. |
| New | `src/uniswap-v3/encoder.ts` | `UNISWAP_V3_VIP` selector + path encoding (`token-fee-token`). |
| New | `src/uniswap-v4/encoder.ts` | `UNISWAP_V4` selector + PoolKey encoding `{currency0, currency1, fee, tickSpacing, hooks=0x0}`. |
| New | `src/uniswap-v4/adapter.ts` | V4 quote-side adapter. Uses on-chain V4 Quoter. |
| New | `src/pancake-v2/encoder.ts` | If Settler exposes Pancake-specific selector, use it; else V2 selector with Pancake factory override. |
| New | `src/pancake-v3/encoder.ts` | Same pattern as V3. |
| New | `src/incentive-portal/encoder.ts` | Incentiv V3 (same selector as V3, but encoder lives with the Incentiv adapter for clarity). |
| Modified | `src/registry.ts` | Register V4 adapter + all encoders via `registerDefaultAdapters()`. |
| Modified | `src/types.ts` | Add `ActionEncoder` interface alongside existing `DexAdapter`. |

### `packages/pricing`

| Action | File | Notes |
|---|---|---|
| New | `src/discovery/v4-pool-discovery.ts` | Enumerate V4 pools by querying PoolManager state for known `(currency0, currency1, fee, tickSpacing, hooks=0x0)` combinations via multicall. |
| New | `src/quotes/v4-quote.ts` | On-chain V4 Quoter calls (V4's exact math is too complex to mirror off-chain safely). |
| Modified | `src/route-planner.ts` | Add V4 hops to candidate set. Split routing covers V4. |
| Modified | `src/__tests__/` | Add V4 fixtures. |

### `packages/contracts`

| Action | File | Notes |
|---|---|---|
| Deleted | `contracts/AequiExecutor.sol` | + ignition module + tests. |
| New | `lib/0x-settler/` | Git submodule, pinned to a specific upstream tag (MIT-licensed; vendored as a dependency). We track 0x release tags. |
| New | `ignition/modules/SettlerIncentiv.js` | Deploys Settler + AllowanceHolder on Incentiv only. Other chains use 0x's deployments. |
| New | `foundry.toml` | Settler is a Foundry project; coexists with Hardhat. |
| Kept | `contracts/AequiLens.sol` | Unchanged. |

### `apps/server`

| Action | File | Notes |
|---|---|---|
| Modified | `src/config/env.ts` | Remove `AEQUI_EXECUTOR_*`. Add `SETTLER_ETH`, `SETTLER_BSC`, `SETTLER_INCENTIV`, `ALLOWANCE_HOLDER_ETH`, `ALLOWANCE_HOLDER_BSC`, `ALLOWANCE_HOLDER_INCENTIV`. Permit2 address is canonical, hardcoded. |
| Modified | `src/config/app-config.ts` | Surface new addresses through `appConfig.settler`, `appConfig.allowanceHolder`. |
| Modified | `src/config/chains.ts` | Each chain entry gets `{ settler, allowanceHolder, permit2 }`. |
| Modified | `src/controllers/swap.controller.ts` | Accept `tokenFlow: 'allowance-holder' \| 'permit2'`. Permit2 mode includes EIP-712 payload in response. |
| Modified | `src/schemas/swap.schema.ts` | Add `tokenFlow` field; new response shape. |
| Modified | `src/deps.ts` | Wire `SettlerBackend` into DI; injected into swap service. |
| Modified | `src/services/health/` | Health check validates Settler bytecode presence on each chain. |
| Updated | `.env.example` | New env names; remove `AEQUI_EXECUTOR_*`. |

### `apps/web`

| Action | File | Notes |
|---|---|---|
| Modified | `src/hooks/use-swap-execution.ts` | Branch on `tokenFlow`. AllowanceHolder: existing approve flow but spender is AllowanceHolder. Permit2: `signTypedData` → inject signature into calldata → send. |
| New | `src/components/TokenFlowSelector.tsx` | Settings UI toggle. Default: AllowanceHolder. |
| Modified | `src/store/swap-store.ts` | Persist `tokenFlow` preference (localStorage). |
| Modified | `src/services/aequi-api.ts` | Pass `tokenFlow` to server; handle new response shape. |
| Modified | `src/types/api.ts` | Mirror server schema changes. |

## 5. Data Flow

### Quote (unchanged)

```
GET /quote?tokenIn=X&tokenOut=Y&amountIn=N&chain=ethereum
  → pricing.discoverPools(X, Y, chain)            # V2/V3/V4 multicall via Lens
  → pricing.planRoutes(pools, amountIn)            # split + multi-hop optimization
  → adapters[hop.protocol].quote(hop, amountIn)    # V2/V3 math, V4 on-chain quoter
  → best route returned
```

### Swap (new)

```
POST /swap { quote, tokenFlow, recipient, slippageBps, deadlineSeconds }
  ↓
1. SwapBuilder.build(quote, params)
2. SettlerBackend constructs the action list:
     a. For each route hop: adapters[hop.protocol].encoder.encodeAction(hop, prevOutput)
     b. Final list (AllowanceHolder mode):
        [TRANSFER_FROM]              # AllowanceHolder pulls input
        [WRAP] (if native input)
        [SWAP_1, SWAP_2, ..., SWAP_N]
        [BASIC: fee transfer]        # FEE_BPS skim → feeRecipient
        [UNWRAP] (if native output)
        [BASIC: settle-out]          # remaining output → recipient
     c. The final `BASIC` settle-out action carries `amountOutMinimum` — Settler reverts the entire batch if the user-bound balance after fee skim falls below it.
3. Calldata encoding:
     - allowance-holder:  AllowanceHolder.exec(settler, actions, msg.value)
     - permit2:           Settler.execute(permitWitnessTransfer, sig, actions)
4. Response:
     { kind, to, data, value, [permit2: { domain, types, message }] }
```

### Permit2 signing flow (web)

```
1. User selects tokenFlow='permit2'.
2. Server response includes EIP-712 payload AND template calldata with signature placeholder.
3. Frontend: wagmi.signTypedData(payload) → signature.
4. Frontend injects signature into calldata at known fixed offset (Settler ABI is positional).
5. wagmi.sendTransaction({ to, data, value }).
```

Rationale for frontend injection over server roundtrip: keeps server stateless, removes a roundtrip. The signature offset is deterministic for a given Settler ABI version — we pin to the vendored submodule's tag, so any upstream ABI shift requires an explicit version bump (caught by the anvil-fork simulation tests in §7, which would revert if the offset moves).

### AllowanceHolder flow (web)

```
1. User selects tokenFlow='allowance-holder' (default).
2. Check: allowance(token, owner, AllowanceHolder) >= amountIn?
   - No → approve(AllowanceHolder, max_uint256) tx (existing useApprove hook).
   - Yes → skip.
3. sendTransaction({ to, data, value }) using server-supplied calldata.
```

### Native token handling

- **Input native**: prepend `WRAP` action; `msg.value = amountIn`.
- **Output native**: append `UNWRAP` action before the final `BASIC` settle-out.

### Multi-hop reconciliation

AequiExecutor used `injectToken/injectOffset` to inject the previous hop's output into the next hop's calldata. Settler solves this with `bps`-based action parameters: each swap action reads its input from the Settler-held balance as a percentage. The existing `EXECUTOR_INTERHOP_BUFFER_BPS` config maps to action-level `bps`.

## 6. Error Handling

### New `ErrorCode` values

```
SETTLER_UNSUPPORTED_CHAIN      - Chain has no Settler address configured
SETTLER_ACTION_ENCODING        - Encoder failed to produce a valid action
SETTLER_QUOTE_STALE            - V4 quoter view reverted / price moved
SETTLER_UNKNOWN_REVERT         - On-chain revert with no known selector
PERMIT2_NONCE_EXHAUSTED        - Reused Permit2 nonce
PERMIT2_DEADLINE_EXPIRED       - Server-detected expired signature deadline
PERMIT2_SIGNATURE_INVALID      - Injected signature fails EIP-712 verification
ALLOWANCE_HOLDER_NOT_APPROVED  - Frontend pre-check (no on-chain approval)
V4_POOL_NOT_FOUND              - PoolKey does not resolve
V4_HOOK_NOT_PERMITTED          - Pool's hooks ≠ address(0) (out of scope)
FEE_ON_TRANSFER_DETECTED       - Token is FoT; non-V2 routes are rejected
```

### Settler revert decoding

`packages/core/src/settler-errors.ts` maps known custom-error selectors (e.g. `TooLittleReceived(uint256,uint256)`, `InvalidSignature()`) to `ErrorCode` values. Unknown selectors surface as `SETTLER_UNKNOWN_REVERT` with raw data attached for the UI.

### Slippage failure ladder

1. **Quote time**: `amountOutMinimum = amountOut * (10_000 - slippageBps) / 10_000`.
2. **Server build**: If `SWAP_QUOTE_TTL_SECONDS` elapsed, return `QUOTE_EXPIRED`; frontend re-quotes.
3. **On-chain**: Settler reverts with `TooLittleReceived`; UI shows "increase slippage tolerance".

### Native token invariants

- Build-time check: native input requires a `WRAP` action; native output requires `UNWRAP`. Violation throws in tests; runtime path raises `SETTLER_ACTION_ENCODING`.
- `msg.value` must equal the wrap amount; mismatch is a build-time error.

### Fee-on-transfer

`TokenMetadata.isFeeOnTransfer` flag is populated during discovery via a maintained tokenlist + lightweight runtime sniff (`balanceOf` delta on a `transfer` simulation, only when the tokenlist does not classify). When set:

- V2 encoder uses Settler's FoT-specific selector.
- V3 / V4 encoders reject the token with `FEE_ON_TRANSFER_DETECTED` (those protocols cannot handle FoT correctly).

### Health check

`/health` validates per-chain Settler bytecode (`bytecode.length > 0`), AllowanceHolder bytecode, and Permit2 reachability. Incentiv uses our deployment addresses.

## 7. Testing

### Unit

- `packages/core`:
  - `swap-builder.test.ts` — `ExecutorBackend` mocked; verifies orchestration.
  - `settler-backend.test.ts` — fixture quote → action list snapshot. AllowanceHolder and Permit2 modes both covered. Native input/output, multi-hop, split routes, fee skim.
  - `settler-errors.test.ts` — revert selector → `ErrorCode` mapping.
- `packages/dex-adapters`:
  - `<dex>/encoder.test.ts` per adapter. Each snapshot is cross-checked against test vectors from the 0x Settler repo.
- `packages/pricing`:
  - Existing V2/V3 tests unchanged.
  - New: `quotes/v4-quote.test.ts`, `discovery/v4-pool-discovery.test.ts` with mocked PoolManager state.

### Integration

- `apps/server/__tests__/swap.controller.test.ts` — Fastify inject covers both modes:
  - AllowanceHolder: assert response shape; calldata is simulated against an anvil fork to confirm it does not revert.
  - Permit2: EIP-712 payload contains correct chainId + Settler domain + witness hash.
- `apps/server/__tests__/health.test.ts` — new Settler address validation.

### Fork tests

- `apps/server/__tests__/fork/ethereum.test.ts` — ETH→USDC, ETH→WETH, multi-hop ETH→USDC→DAI.
- `apps/server/__tests__/fork/bsc.test.ts` — BNB→BUSD, multi-hop.
- `apps/server/__tests__/fork/incentiv.test.ts` — native→stable on Incentiv (using our self-deployed Settler).
- Each test runs against an Anvil/Hardhat fork at a pinned block.

### Contracts

- `AequiLens.sol` tests unchanged.
- `SettlerIncentiv.js` Ignition module: dry-run deployment test under Hardhat fork.
- Vendored Settler: 0x's own Foundry tests run via `forge test` in CI; we do not modify the contracts.

### Web

- `use-swap-execution.test.tsx` — wagmi mocked; both `tokenFlow` paths exercised.
- `TokenFlowSelector.test.tsx` — toggle persists, default is `allowance-holder`.
- Manual smoke after release: a real small swap on each chain from a test wallet (forks are insufficient for the final go/no-go).

### CI

- `turbo run test` includes all of the above (already `cache: false`).
- New optional `test:fork` target. Locally skipped if Anvil is not running; required in CI.
- `check-types` and `lint` must pass across all touched packages.

## 8. Migration Sequence (high-level only — implementation plan to follow)

1. Vendor 0x Settler as a git submodule under `packages/contracts/lib/0x-settler/`. Configure Foundry alongside Hardhat.
2. Deploy Settler + AllowanceHolder on Incentiv via the new Ignition module. Pin the deployed addresses.
3. Build `ExecutorBackend` + `SettlerBackend` in `packages/core` alongside the existing `swap-builder.ts` (do not remove yet).
4. Add per-DEX `ActionEncoder`s in `packages/dex-adapters`.
5. Add V4 discovery + V4 adapter + V4 encoder. Hook scope: `hooks=address(0)` only.
6. Switch `swap-builder.ts` to delegate to `SettlerBackend`. Delete AequiExecutor ABI references.
7. Update server config, controller, schemas, deps. Update health check.
8. Update web hook, add `TokenFlowSelector`, update store and API client.
9. Delete `contracts/AequiExecutor.sol` + ignition + tests.
10. Run full test suite including fork tests on all three chains.
11. Manual smoke swaps on each chain.
12. Release.

## 9. Out of Scope

- Hooked V4 pools (`hooks ≠ 0x0`).
- New chains beyond Ethereum, BSC, Incentiv.
- DEX additions beyond V4 (Curve, Balancer, Maverick, Dodo, etc.) — handled in follow-up PRs once Settler is the live backend.
- MEV protection / private mempool integration.
- Gas estimation overhaul — current backend simulation continues to apply.

## 10. Open Implementation Details

These are deliberately deferred to implementation, with a noted default:

- **Permit2 signature placement**: default to frontend injection (server stateless); revisit if Settler ABI's signature offset turns out to be variable.
- **Settler version pinning**: track 0x's `main` branch via submodule, pin to the latest tagged release at migration time. A separate task tracks upgrades.
- **FoT detection heuristic**: tokenlist first; runtime sniff only when classification is missing.
- **V4 Quoter address**: read from V4's canonical deployment per chain. Uniswap V4 is live on Ethereum and BNB Chain (the two non-Incentiv chains in scope). Incentiv has no V4 deployment, so V4 hops are filtered out of route candidates on Incentiv at the pricing layer.
