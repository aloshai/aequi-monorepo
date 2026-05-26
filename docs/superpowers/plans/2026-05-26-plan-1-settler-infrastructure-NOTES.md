# Plan 1 — Settler Infrastructure Investigation Notes

Investigation outputs from executing Plan 1 against the vendored 0x Settler at commit `5a23151a10bc0a9af443dcb47eda039cf6295e01` (master tip as of 2026-05-26).

## Settler chain integration shape

Each supported chain has a directory `src/chains/<Chain>/` with five files:

| File | Purpose |
|---|---|
| `Common.sol` | Defines `<Chain>Mixin` — the abstract base that bundles all DEX action handlers available on that chain (e.g. `UniswapV3Fork`, `UniswapV4`, `PancakeInfinity` mix-ins). |
| `TakerSubmitted.sol` | `<Chain>Settler` — the AllowanceHolder-mode Settler. Inherits `Settler` + `<Chain>Mixin`. Implements `_dispatchVIP` to route VIP actions (Permit2 in-line). |
| `MetaTxn.sol` | `<Chain>SettlerMetaTxn` — the Permit2-only meta-transaction Settler. |
| `Intent.sol` | `<Chain>SettlerIntent` — advanced intent-based variant (RFQ / cross-chain). Not relevant to Aequi at this stage. |
| `BridgeSettler.sol` | Cross-chain bridge Settler. Not relevant to Aequi. |

For Aequi's purposes we care about exactly two contracts per chain: `<Chain>Settler` (AllowanceHolder mode) and `<Chain>SettlerMetaTxn` (Permit2 mode).

## chain_config.json structure

Top-level keys use lowercase chain identifiers (e.g. `mainnet`, `bsc`, `polygon`). The BSC entry uses key `"bsc"` even though the chain directory is `src/chains/Bnb/`. The relevant fields for Aequi:

| Field | Use |
|---|---|
| `chainId` | Numeric chain ID. |
| `wnative` | Wrapped-native ERC20 (WETH / WBNB). Already known by Aequi but useful cross-check. |
| `deployment.allowanceHolder` | **Identical across all chains:** `0x0000000000001fF3684f28c67538d4D072C22734`. CREATE2-derived from `deployer = 0x00000000000004533Fe15556B1E086BB1A72cEae`. |
| `deployment.deployer` | Settler's own deployer factory. Identical across chains. |
| `deployment.forwardingMultiCall` | Generic multicall (`0x00000000000000CF9E3c5A26621af382fA17f24f`). Identical across chains. |
| `deployment.crossChainFactory` | Not used by Aequi. |

**`<Chain>Settler` and `<Chain>SettlerMetaTxn` addresses are NOT in chain_config.json.** They are CREATE2-derived from the deployer + a per-version salt. To find the live addresses for a given chain:

1. Visit `https://api.etherscan.io/v2/api?chainid=<id>&module=account&action=txlist&address=<deployer>` (the deployer address above). Look for `CREATE2` deployments. The most recent deployment for each chain is the active Settler.
2. Or query the chain's `Created` events on the deployer contract.
3. Or check 0x's matcha.xyz routing — the `to` address of any Settler swap on that chain IS the Settler address.

A future plan task will resolve these at deployment time and hardcode them in `apps/server/src/config/app-config.ts`. Until then, Task 7 uses TODO placeholders.

## Deployment scripts (for reference — Plan 1 does not run these)

All scripts honor `BROADCAST=no` for simulation and `BROADCAST=yes` for live deploy:

| Script | Effect |
|---|---|
| `sh/deploy_multicall.sh <Chain>` | Deploys `forwardingMultiCall` (only needed once per chain, already done on ETH/BSC). |
| `sh/deploy_crosschainfactory.sh <Chain>` | Deploys `crossChainFactory` (not used by Aequi). |
| `sh/deploy_allowanceholder.sh <Chain>` | Deploys `AllowanceHolder` (only needed once per chain). |
| `sh/deploy_new_chain.sh <Chain>` | Deploys `<Chain>Settler` + `<Chain>SettlerMetaTxn` for a brand-new chain. |
| `sh/deploy_new_settler.sh <Chain>` | Deploys a new Settler version on an existing chain (after code changes). |

Scripts read chain name as `$1`, load corresponding entry from `chain_config.json`, call `forge script` with the right RPC.

## Incentiv — deferred work

Plan 1 deliberately does NOT add Incentiv chain support to Settler. To do that later:

1. Add an `"incentiv"` entry to `chain_config.json` mirroring the `"bsc"` structure (chainId 24101, `wnative` = Incentiv's WINTV).
2. Create `src/chains/Incentiv/` mirroring `Bnb/`, but the `IncentivMixin` should only mix in `UniswapV3Fork` (since Incentiv only has Incentiv V3, a Uniswap V3 fork). Strip `UniswapV4`, `PancakeInfinity`, etc.
3. The `IncentivMixin._uniV3ForkInfo` override must reference Incentiv V3's factory + init-code hash from `packages/dex-adapters/src/incentive-portal/`.
4. Run `BROADCAST=no ./sh/deploy_new_chain.sh Incentiv` to dry-run.
5. Fund `0x00000000000004533Fe15556B1E086BB1A72cEae` on Incentiv (the deployer EOA — actually Settler's deployer is a contract, but the deploying EOA must hold INTV).
6. `BROADCAST=yes` to live-deploy. Record addresses.
7. Update `apps/server/src/config/app-config.ts` `INCENTIV_SETTLER_DEFAULT` and `INCENTIV_ALLOWANCE_HOLDER_DEFAULT` constants.

The Aequi server is functional on Incentiv WITHOUT Settler in the interim, but only through whatever execution path Aequi keeps for that chain. Plan 2 onwards assumes Settler is the only execution backend, so Plan 1's deferred Incentiv work blocks production use of Aequi on Incentiv until completed.

## Settler action ABI (for Plan 2's encoders)

Action selectors are defined in `src/ISettlerActions.sol`. Each action's first 4 bytes of the function selector are the dispatch key. Aequi-relevant actions:

| Selector function (in `ISettlerActions`) | Use case |
|---|---|
| `TRANSFER_FROM(address recipient, ISignatureTransfer.PermitTransferFrom permit, bytes sig)` | Permit2 pull. AllowanceHolder mode skips this — AllowanceHolder calls Settler's `execute(...)` already holding the tokens. |
| `UNISWAPV2(address recipient, address sellToken, uint256 bps, address pool, uint24 swapInfo, uint256 amountOutMin)` | V2 / Pancake V2 / any V2 fork. `swapInfo` packs `(zeroForOne, feeBps)`. |
| `UNISWAPV3(address recipient, uint256 bps, bytes path, uint256 amountOutMin)` | V3 / Pancake V3 / Incentiv V3 / any V3 fork. Path is standard `token-fee-token` packed bytes. |
| `UNISWAPV3_VIP(address recipient, PermitTransferFrom permit, bytes sig, bytes path, uint256 amountOutMin)` | V3 with embedded Permit2 (single-action swap, no separate TRANSFER_FROM). |
| `UNISWAPV4(address recipient, address sellToken, uint256 bps, bool fot, uint256 amountOutMin, uint256 hashMul, uint256 hashMod, bytes fills, uint256 _unused)` | V4 hookless pools. `fills` packs the PoolKey + per-hop instructions. |
| `BASIC(address sellToken, uint256 bps, address pool, uint256 offset, bytes data)` | Generic external call. Used by Settler for fee recipient transfers and other utility calls. |
| `CHECK_SLIPPAGE(bool)` | Asserts the slippage guard hasn't been violated. Used as the final action when the swap action's built-in `amountOutMin` is insufficient. |
| `POSITIVE_SLIPPAGE(address recipient, address sellToken, uint256 expectedAmount, uint256 amountOutMin)` | Sends positive slippage above expected to a recipient. Used for fee collection in 0x's reference deployments. |

The fee-collection pattern: use `POSITIVE_SLIPPAGE(feeRecipient, outputToken, expectedAmount, amountOutMin)` as the last action — Settler measures the actual output, sends anything above `expectedAmount` to `feeRecipient`, and ensures the user receives at least `amountOutMin`. Aequi's `FEE_BPS = 30` translates to `expectedAmount = amountOut * (1 - 30/10_000)`.

## License confirmation

`packages/contracts/lib/0x-settler/LICENSE.txt`: **MIT** (verified). Aequi's Apache 2.0 license is unaffected by vendoring Settler.

## Windows-specific note

The recursive submodule init failed for deeply nested transitive deps (`lib/euler-swap/lib/v4-periphery/lib/v4-core/lib/openzeppelin-contracts/lib/forge-std/lib/ds-test` exceeds Windows `MAX_PATH`). Enabled `git config --global core.longpaths true` but `$GIT_DIR` envvar itself becomes too long.

Mitigation: skip the deepest transitive submodules. `forge build` does not work for the entire Settler tree on Windows, but Aequi's migration only needs to **read** Settler source for action encoding patterns — not build the contracts. If on-chain deployment is needed later, do it from a Linux/macOS host or move the repo to a shorter parent path (e.g. `C:\src\aequi`).
