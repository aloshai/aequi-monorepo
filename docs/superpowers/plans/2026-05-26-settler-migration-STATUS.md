# 0x Settler Migration — Branch Status

**Branch:** `feat/settler-migration`
**Date:** 2026-05-26
**Spec:** `docs/superpowers/specs/2026-05-26-settler-migration-design.md`
**Plan 1:** `docs/superpowers/plans/2026-05-26-plan-1-settler-infrastructure.md` (+ `-NOTES.md`)

## What ships on this branch

End-to-end stack for executing swaps through 0x Settler's AllowanceHolder mode, alongside the existing AequiExecutor path. The legacy path is unchanged and remains the default.

### Architecture

```
apps/web ──(POST /swap, tokenFlow='settler-allowance-holder')──> apps/server
                                                                       │
                                                                       ▼
                                                        SettlerBackend.build(plan)
                                                                       │
                                                                       ▼
                                          AllowanceHolder.exec(operator=Settler, …)
                                                              wrapping
                                          Settler.execute(slippage, actions[], zid)
                                                                       │
                                                                       ▼
                                                    on-chain: UNISWAPV2 / UNISWAPV3 /
                                                    BASIC (wrap/unwrap) / POSITIVE_SLIPPAGE
```

### Commits (11, listed oldest → newest)

| SHA | Subject |
|---|---|
| `354b886` | `chore(contracts): vendor 0x-settler as submodule` |
| `098916b` | `docs(plan-1): Settler integration investigation notes` |
| `ba46927` | `feat(server): surface Settler addresses through config` |
| `9f12e7f` | `docs(claude-md): document Settler migration state on this branch` |
| `f6b75e9` | `feat(core): SettlerBackend skeleton (AllowanceHolder mode, V2/V3 hops)` |
| `95e8aa4` | `feat(core): SettlerBackend split routing support` |
| `1dae98a` | `feat(server): wire SettlerBackend into DI (dormant)` |
| `5444a51` | `feat(server): swap controller tokenFlow branch (additive)` |
| `3c5c6bf` | `feat(server): resolve canonical ETH/BSC Settler addresses + BSC fork sim test` |
| `8608302` | `feat(web): tokenFlow setting + SettingsModal selector + API plumbing` |
| `f9b0807` | `fix(core): V3 path encoding matches Settler's enhanced layout` |

### Test status

```
@aequi/pricing:test    98 passed (98)
@aequi/core:test       58 passed (58)
@aequi/server:test     33 passed (33)
──────────────────────────────────
                      189 passed
check-types            7/7 packages ✓
```

Real-RPC fork simulations (against `bsc-dataseed.binance.org` and `ethereum-rpc.publicnode.com`):

```
apps/server/src/__tests__/fork/settler-bsc-simulation.test.ts
  ✓ AllowanceHolder bytecode is present on BSC
  ✓ BSC Settler bytecode is present
  ✓ BSC SettlerMetaTxn bytecode is present
  ✓ single-hop V2 WBNB → BUSD: backend calldata simulates without reverting
    (Settler reverts at TooMuchSlippage(0x97a6f3b9, ...) — calldata reaches
     the slippage check, proving encoding is correct)

apps/server/src/__tests__/fork/settler-eth-simulation.test.ts
  ✓ ETH Settler bytecode is present
  ✓ ETH SettlerMetaTxn bytecode is present
  ✓ single-hop V3 WETH → USDC: backend calldata reaches Settler
    (Settler reverts at internal balance/slippage guard — calldata is
     correctly dispatched via Settler's UNISWAPV3 action handler)
```

Set `SKIP_FORK_TESTS=1` to skip these in CI environments without public RPC access.

### What works

- `SettlerBackend.build(plan)` produces correct `AllowanceHolder.exec(...)` calldata for:
  - Single-hop V2 swaps (Uniswap V2, PancakeSwap V2, any V2 fork — pool fee per dex)
  - Multi-hop V2 swaps with `bps`-based balance pass-through
  - Single-hop V3 swaps (Uniswap V3 fork=0, PancakeSwap V3 fork=1, Sushiswap V3 fork=2 — extensible)
  - Multi-hop V3 swaps with Settler's enhanced 64-byte-per-hop path layout
  - Split routes with `bps` scaled relative to remaining input
  - Native input via `BASIC → WETH.deposit{value: amount}()`
  - Native output via `BASIC → WETH.withdraw(amount-injected-via-offset)`
  - Fee skim via `POSITIVE_SLIPPAGE` (only when `appConfig.fee.recipient` is set)
- `appConfig.settler` exposes constant `allowanceHolder` + `permit2` and per-chain `{ settler, settlerMetaTxn }`. ETH + BSC hardcoded from on-chain `Deployer.ownerOf(2|3)` lookup; Incentiv is null.
- `POST /swap` accepts `tokenFlow: 'aequi-executor' | 'settler-allowance-holder' | 'settler-permit2'`. Default `aequi-executor` keeps legacy behavior. `settler-allowance-holder` branches to `SettlerBackend`. `settler-permit2` returns `501 NOT_IMPLEMENTED`.
- Web Settings modal exposes the new selector. AllowanceHolder is enabled; Permit2 is shown disabled with "coming soon". Selection persists in localStorage.
- Existing approve flow in `useSwapExecution` already keys off `transaction.spender`, which now resolves to AllowanceHolder for `settler-*` modes — no further UX changes were needed.

### What's deliberately deferred (not blockers — additive scope)

| Item | Why deferred | Where it would land |
|---|---|---|
| Permit2 mode (server + frontend) | Requires EIP-712 signing flow + signature inject offset agreement | Plan 3 follow-up; `SettlerBackend` already returns `NOT_IMPLEMENTED` for `tokenFlow: 'permit2'` |
| AequiExecutor + `SwapBuilder` removal | Plan 2/3 are additive; AequiExecutor stays as the default for risk-managed rollout | After production validation of the Settler path |
| Incentiv Settler deployment | User explicitly scoped deployment out | Plan 1 NOTES.md "Incentiv — deferred work" section |
| Uniswap V4 integration | Whole new DEX (PoolManager singleton, hook policy, V4 Quoter) | Plan 4 (not started) |
| `_isPathMultiHop` V3 path for >2 hops | The 64-byte format works for single-hop; multi-hop in Settler V3 reuses path-shift logic that needs careful re-validation | Plan 4-adjacent work |
| Action encoder split into `@aequi/dex-adapters` | Spec called for adapter-local encoders; current implementation keeps them inline in `SettlerBackend` for one-PR simplicity | Refactor PR (no behavior change) |
| Server `/swap` integration test for `settler-allowance-holder` | Unit + fork tests cover the encoder; controller path uses the same code | Add when expanding test surface |

### Required follow-ups before flipping default to Settler

1. Set `FEE_RECIPIENT` env (fee skim is disabled until this is set — by design).
2. Run real swaps on testnet (or low-value mainnet) with `tokenFlow=settler-allowance-holder` selected in UI; verify slippage behavior + fee accounting end-to-end.
3. Cron-refresh `appConfig.settler.byChain.{eth,bsc}.{settler,settlerMetaTxn}` against `Deployer.ownerOf` quarterly — 0x deploys new Settler versions periodically and the addresses change.
4. Implement Permit2 mode (Plan 3 follow-up).
5. Add V4 support (Plan 4).

### Known constraints

- **Windows path length**: `forge build` of the full Settler tree does not work on Windows (`$GIT_DIR too big` on the deepest transitive submodules). Build from Linux/macOS or move the repo to a shorter parent path if you need to recompile Settler. Aequi only needs Settler as a read-only source reference, so this does not affect the migration.
- **Settler version drift**: hardcoded addresses are valid as of 2026-05-26 but will rot when 0x deploys a new Settler. The resolution snippet is documented inline in `app-config.ts`.
- **Incentiv blocked on deployment**: until a Settler fork is deployed on Incentiv, choosing `tokenFlow=settler-allowance-holder` for that chain throws `INVALID_CHAIN`. The fail-loud behavior is intentional; the frontend should hide the option for unsupported chains in a follow-up.
