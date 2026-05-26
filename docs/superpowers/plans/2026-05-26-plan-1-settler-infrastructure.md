# Plan 1: Settler Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor 0x Settler as a git submodule, add Incentiv chain support to the vendored copy, and deploy `Settler` + `AllowanceHolder` to Incentiv. Surface deployed addresses through env + chain config so subsequent plans can reference them.

**Architecture:** 0x Settler is a Foundry project, MIT-licensed. We add it as `packages/contracts/lib/0x-settler/` pointing to our own fork on the user's GitHub (so we can land Incentiv chain config without waiting on upstream). Deployment is performed by Settler's own shell scripts, run by the user with a funded Incentiv key. Hardhat is not modified — Settler coexists as an independent Foundry sub-project.

**Tech Stack:** Foundry (`forge`, `cast`), git submodules, Solidity 0.8.x (Settler's own version), Hardhat untouched.

**Prerequisites the engineer must have locally:**
- `git` ≥ 2.30
- `foundryup` (https://book.getfoundry.sh/getting-started/installation) — installs `forge` and `cast`
- An Incentiv-funded EOA private key (for the deployment task only; the rest is local work)
- `gh` CLI authenticated (for forking the upstream repo)

**Out of scope:** Building action encoders, modifying server/web. Those are Plan 2 and Plan 3.

---

## File Structure (Plan 1 output)

After this plan completes, the repo has:

```
packages/contracts/
├── .gitmodules                              # NEW — declares lib/0x-settler submodule
├── lib/
│   └── 0x-settler/                          # NEW — submodule, our fork @ pinned commit
│       └── (Settler's own tree, with our Incentiv additions on a branch)
└── ignition/deployments/chain-24101/
    └── settler-addresses.json               # NEW — written after deployment
```

```
apps/server/src/config/
├── env.ts                                   # MODIFIED — new Settler/AllowanceHolder envs
├── app-config.ts                            # MODIFIED — surface new addresses
└── chains.ts                                # MODIFIED — attach addresses per chain
```

```
.env.example                                 # MODIFIED — document new envs
docs/superpowers/plans/
└── 2026-05-26-plan-1-settler-infrastructure-NOTES.md  # NEW — investigation notes
```

---

## Task 1: Fork upstream 0x-settler

We need a writable upstream to add Incentiv chain support. Forking via `gh` keeps it in the user's GitHub org without copying source manually.

**Files:**
- None in our repo yet.

- [ ] **Step 1: Confirm `gh` authenticated**

Run:
```bash
gh auth status
```
Expected: shows authenticated user. If not, run `gh auth login` first.

- [ ] **Step 2: Fork the upstream repo**

Run:
```bash
gh repo fork 0xProject/0x-settler --clone=false --remote=false
```
Expected: prints the URL of the new fork, e.g. `<your-user>/0x-settler`. If the fork already exists, `gh` exits successfully with no error.

- [ ] **Step 3: Record the fork URL**

Note the fork URL (e.g. `https://github.com/<your-user>/0x-settler.git`). It will be the submodule URL in Task 2.

No commit yet — this task only touches GitHub.

---

## Task 2: Add the fork as a submodule under `packages/contracts/lib/0x-settler`

**Files:**
- Create: `packages/contracts/.gitmodules`
- Modify (git-tracked): `packages/contracts/lib/0x-settler/` (submodule pointer)

- [ ] **Step 1: From repo root, add the submodule**

Run (replace `<fork-url>` with the URL from Task 1, Step 3):
```bash
git submodule add <fork-url> packages/contracts/lib/0x-settler
```
Expected: `Cloning into 'packages/contracts/lib/0x-settler'... done.`

- [ ] **Step 2: Initialize Settler's own submodules recursively**

Run:
```bash
git submodule update --init --recursive packages/contracts/lib/0x-settler
```
Expected: clones forge-std, openzeppelin-contracts, permit2, and other Settler deps.

- [ ] **Step 3: Verify Settler builds**

Run:
```bash
cd packages/contracts/lib/0x-settler && forge build && cd -
```
Expected: `Compiler run successful!` (warnings are OK, errors are not).

- [ ] **Step 4: Commit the submodule addition**

Run:
```bash
git add .gitmodules packages/contracts/lib/0x-settler
git commit -m "chore(contracts): vendor 0x-settler as submodule"
```
Expected: commit created. Verify with `git log -1 --stat`.

---

## Task 3: Document Settler's chain integration pattern in a NOTES file

Before adding Incentiv to the fork, we need to understand exactly which files Settler touches when adding a new chain. This is genuine investigation — we read the existing `Bnb/` chain (closest analog to Incentiv: EVM-compatible, no L2 specifics) and write notes.

**Files:**
- Create: `docs/superpowers/plans/2026-05-26-plan-1-settler-infrastructure-NOTES.md`

- [ ] **Step 1: Read Settler's BNB chain integration**

Run:
```bash
ls packages/contracts/lib/0x-settler/src/chains/Bnb/
```
Then `cat` each Solidity file in that directory.

Expected: discover the file naming pattern (likely `Bnb.sol`, possibly settler+meta-txn variants).

- [ ] **Step 2: Read Settler's chain_config.json for BNB**

Run:
```bash
grep -A 30 '"Bnb"' packages/contracts/lib/0x-settler/chain_config.json
```
Expected: see the BNB entry — RPC URL, chain ID, salt, deployment-relevant config keys.

- [ ] **Step 3: Read the deploy scripts referenced**

Run:
```bash
ls packages/contracts/lib/0x-settler/sh/ | head -20
cat packages/contracts/lib/0x-settler/sh/deploy_new_chain.sh
cat packages/contracts/lib/0x-settler/sh/deploy_allowanceholder.sh
```
Expected: scripts read chain name as `$1`, load corresponding entry from `chain_config.json`, call `forge script` with the right RPC.

- [ ] **Step 4: Write the NOTES file**

Create `docs/superpowers/plans/2026-05-26-plan-1-settler-infrastructure-NOTES.md` with this exact structure (fill in real findings):

```markdown
# Plan 1 — Settler Chain Integration Notes

## Files Settler expects when adding a new chain

For chain `<Bnb>` the files are:
- `src/chains/<Bnb>/<Bnb>.sol`  — extends `SettlerBase`, mixes in DEX action handlers available on that chain.
- `src/chains/<Bnb>/<Bnb>MetaTxn.sol` — Permit2 variant.
- (other files discovered)

## chain_config.json entry shape

```json
"Bnb": {
  "chainId": 56,
  ... (paste the actual structure here)
}
```

## Deploy scripts

- `sh/deploy_multicall.sh <Chain>` — deploys Multicall3 if not already on chain.
- `sh/deploy_crosschainfactory.sh <Chain>` — deploys CrossChainReceiverFactory.
- `sh/deploy_allowanceholder.sh <Chain>` — deploys AllowanceHolder.
- `sh/deploy_new_chain.sh <Chain>` — deploys Settler + SettlerMetaTxn.

All scripts honor `BROADCAST=no` for dry-run and `BROADCAST=yes` for live deploy.

## Incentiv specifics

- Chain ID: 24101
- RPC: https://rpc.incentiv.io
- Native: INTV
- DEXes available: Incentiv V3 (Uniswap V3 fork) — adapter key `incentive-portal-v3`.
- Therefore Incentiv's Settler should mix in only the UniswapV3 action; UniswapV2, V4, PancakeInfinity, etc. are not relevant.
```

- [ ] **Step 5: Commit the notes**

Run:
```bash
git add docs/superpowers/plans/2026-05-26-plan-1-settler-infrastructure-NOTES.md
git commit -m "docs: investigate Settler chain integration for Incentiv"
```

---

## Task 4: Add Incentiv chain entry to vendored Settler

Work happens inside the submodule. Changes get pushed to the fork, then the submodule pointer in the outer repo is updated.

**Files (inside `packages/contracts/lib/0x-settler/`):**
- Modify: `chain_config.json` — add `Incentiv` entry
- Create: `src/chains/Incentiv/Incentiv.sol` — mirrors `Bnb.sol` minus V2/V4/Pancake actions, keeps V3 only
- Create: `src/chains/Incentiv/IncentivMetaTxn.sol` — Permit2 variant

- [ ] **Step 1: Branch the submodule**

Run:
```bash
cd packages/contracts/lib/0x-settler
git checkout -b aequi/incentiv-support
```
Expected: switched to new branch.

- [ ] **Step 2: Add Incentiv to chain_config.json**

Open `chain_config.json` and add an entry mirroring `Bnb`'s shape (use the structure recorded in the NOTES file). Concretely (paste exactly, using the actual key names from the NOTES file — the structure below is the conceptual shape, not verbatim until verified):

```json
"Incentiv": {
  "chainId": 24101,
  "rpcUrl": "https://rpc.incentiv.io",
  "explorer": "https://explorer.incentiv.io",
  "nativeSymbol": "INTV",
  "deployerSalt": "0x<32-byte-salt-to-be-generated>",
  "dexes": ["UniswapV3"]
}
```

If the NOTES file's BNB entry has additional required keys, mirror them. The salt should be a fresh 32-byte hex string (`cast wallet new --json | jq -r .[0].address` then hash, or `openssl rand -hex 32`).

- [ ] **Step 3: Create `src/chains/Incentiv/Incentiv.sol`**

Use `src/chains/Bnb/Bnb.sol` as a template. Strip out everything except `UniswapV3` action mix-in. The file's contract should:
- Inherit from `SettlerBase`.
- Override the actions registry to expose only `UNISWAPV3`, `BASIC`, `POSITIVE_SLIPPAGE`, `CHECK_SLIPPAGE`, `TRANSFER_FROM` (the bare minimum for aggregator execution on a single-DEX chain).
- Not import or reference `UNISWAPV2`, `UNISWAPV4`, `PANCAKE_INFINITY`, `CURVE_TRICRYPTO_VIP`, etc.

Concrete code skeleton (refine against the actual Bnb.sol structure):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity =0.8.25;

import {SettlerBase} from "../../SettlerBase.sol";
import {UniswapV3Fork} from "../../core/UniswapV3Fork.sol";
// ... other minimal imports as in Bnb.sol

abstract contract IncentivMixin is SettlerBase, UniswapV3Fork {
    // Chain-specific constants: factory, init code hash for Incentiv V3
    address internal constant INCENTIV_V3_FACTORY = 0x<paste from packages/dex-adapters/src/incentive-portal/...>;
    bytes32 internal constant INCENTIV_V3_INIT_HASH = 0x<paste from same source>;

    function _uniV3ForkInfo(uint256 forkId)
        internal
        pure
        override
        returns (address factory, bytes32 initHash, uint256 callbackSelector)
    {
        if (forkId == 0) {
            return (INCENTIV_V3_FACTORY, INCENTIV_V3_INIT_HASH, /* callback selector */);
        }
        revert("unknown fork");
    }
}

contract IncentivSettler is IncentivMixin {
    constructor(bytes20 gitCommit) SettlerBase(gitCommit) {}
}
```

Read `Bnb.sol` carefully — the exact override signatures and constant names may differ. The skeleton above shows the pattern, not the verbatim final code.

- [ ] **Step 4: Create `src/chains/Incentiv/IncentivMetaTxn.sol`**

Mirror `src/chains/Bnb/BnbMetaTxn.sol`. The file should mix `IncentivMixin` with `SettlerMetaTxn`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity =0.8.25;

import {SettlerMetaTxn} from "../../SettlerMetaTxn.sol";
import {IncentivMixin} from "./Incentiv.sol";

contract IncentivSettlerMetaTxn is IncentivMixin, SettlerMetaTxn {
    constructor(bytes20 gitCommit) SettlerBase(gitCommit) {}
}
```

- [ ] **Step 5: Build to verify**

Run:
```bash
forge build
```
Expected: `Compiler run successful!` with no errors. Warnings about unused imports are OK; fix anything red.

- [ ] **Step 6: Commit to the fork branch**

Run:
```bash
git add chain_config.json src/chains/Incentiv/
git commit -m "feat: add Incentiv chain support (single-DEX: Incentiv V3)"
git push -u origin aequi/incentiv-support
```
Expected: branch pushed to fork.

- [ ] **Step 7: Update outer repo submodule pointer**

Run:
```bash
cd ../../../..    # back to repo root
git add packages/contracts/lib/0x-settler
git commit -m "chore(contracts): pin Settler submodule to aequi/incentiv-support branch tip"
```
Expected: outer repo records the new submodule SHA.

---

## Task 5: Dry-run deployment to Incentiv

Verify the Settler scripts work against Incentiv RPC without broadcasting.

**Files:**
- None (read-only run).

- [ ] **Step 1: Export env vars**

Run (set your funded Incentiv key — does NOT broadcast yet):
```bash
export INCENTIV_PRIVATE_KEY=0x<your-funded-incentiv-eoa-key>
export RPC_INCENTIV=https://rpc.incentiv.io
```

- [ ] **Step 2: Dry-run AllowanceHolder deployment**

Run from `packages/contracts/lib/0x-settler/`:
```bash
BROADCAST=no ./sh/deploy_allowanceholder.sh Incentiv
```
Expected: `forge script` prints a simulation showing the AllowanceHolder bytecode + the deterministic CREATE2 address. No transaction sent. If it errors with "chain not found", check that Task 4 chain_config.json edit landed and the branch is the current submodule HEAD.

- [ ] **Step 3: Dry-run Settler deployment**

Run:
```bash
BROADCAST=no ./sh/deploy_new_chain.sh Incentiv
```
Expected: simulation shows `IncentivSettler` and `IncentivSettlerMetaTxn` deployment with predicted addresses. Note the addresses — they will be the same when broadcast=yes (CREATE2).

- [ ] **Step 4: Record predicted addresses**

Create file `packages/contracts/ignition/deployments/chain-24101/settler-addresses.json`:

```json
{
  "settler": "0x<predicted-from-step-3>",
  "settlerMetaTxn": "0x<predicted-from-step-3>",
  "allowanceHolder": "0x<predicted-from-step-2>",
  "permit2": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "deployedAt": null,
  "deployerCommit": "<git rev-parse --short HEAD inside submodule>"
}
```

- [ ] **Step 5: Commit predicted addresses**

Run:
```bash
git add packages/contracts/ignition/deployments/chain-24101/settler-addresses.json
git commit -m "chore(contracts): record predicted Settler addresses for Incentiv"
```

---

## Task 6: Live deployment to Incentiv

This task moves funds. The engineer (user) MUST confirm before running each `BROADCAST=yes` command. The agent should NOT auto-run these.

**Files:**
- Modify: `packages/contracts/ignition/deployments/chain-24101/settler-addresses.json` (fill `deployedAt`)

- [ ] **Step 1: Confirm funding**

Run:
```bash
cast balance $(cast wallet address $INCENTIV_PRIVATE_KEY) --rpc-url $RPC_INCENTIV
```
Expected: balance ≥ enough INTV to cover three deployments (estimate ≈ 0.1 INTV; observe simulation gas in Task 5 to tighten). If insufficient, stop and fund the EOA first.

- [ ] **Step 2: Deploy AllowanceHolder live**

Run:
```bash
BROADCAST=yes ./sh/deploy_allowanceholder.sh Incentiv
```
Expected: tx broadcast, confirmation prints deployed address (must match the predicted address from Task 5 Step 2). If addresses diverge, abort — something is wrong with chain_config salt.

- [ ] **Step 3: Verify AllowanceHolder bytecode**

Run:
```bash
cast code <allowance-holder-address> --rpc-url $RPC_INCENTIV | head -c 100
```
Expected: non-empty hex starting with `0x60`. Empty result means deployment did not land.

- [ ] **Step 4: Deploy Settler + MetaTxn live**

Run:
```bash
BROADCAST=yes ./sh/deploy_new_chain.sh Incentiv
```
Expected: two contracts deployed (Settler, SettlerMetaTxn). Both addresses must match Task 5 Step 3 predictions.

- [ ] **Step 5: Verify Settler bytecode**

Run:
```bash
cast code <settler-address> --rpc-url $RPC_INCENTIV | head -c 100
cast code <settler-meta-txn-address> --rpc-url $RPC_INCENTIV | head -c 100
```
Expected: both non-empty.

- [ ] **Step 6: Update addresses file with deployment timestamp**

Edit `packages/contracts/ignition/deployments/chain-24101/settler-addresses.json`:
- Set `deployedAt` to the ISO 8601 timestamp of deployment (`date -u +%FT%TZ`).
- Confirm all addresses match what was actually deployed.

- [ ] **Step 7: Commit**

Run:
```bash
git add packages/contracts/ignition/deployments/chain-24101/settler-addresses.json
git commit -m "chore(contracts): record live Settler deployment on Incentiv"
```

---

## Task 7: Wire deployed addresses into server config

Surface the addresses (for all three chains: ETH, BSC, Incentiv) through env + chain config. Ethereum and BSC use 0x's canonical deployments; we need to pin those too.

**Files:**
- Modify: `apps/server/src/config/env.ts`
- Modify: `apps/server/src/config/app-config.ts`
- Modify: `apps/server/src/config/chains.ts`
- Modify: `apps/server/src/config/constants.ts`
- Modify: `.env.example`

- [ ] **Step 1: Find canonical 0x Settler addresses on ETH + BSC**

Read `packages/contracts/lib/0x-settler/sh/common.sh` and `script/Deployer.s.sol` (or wherever Settler stores known deployment addresses), and `chain_config.json` Mainnet + Bnb entries. The Settler deployer uses deterministic CREATE2, so addresses are derivable. Record them in the NOTES file under a new "## Canonical addresses" heading:

```
Mainnet (chainId 1):
  Settler:         0x...
  SettlerMetaTxn:  0x...
  AllowanceHolder: 0x...

BNB (chainId 56):
  Settler:         0x...
  SettlerMetaTxn:  0x...
  AllowanceHolder: 0x...
```

If the addresses are not in the repo, fetch them from https://github.com/0xProject/0x-settler/tree/master/broadcast (the broadcast directory has chain-organized deployment receipts) and verify on chain with `cast code`.

- [ ] **Step 2: Add a failing test for env loading**

Create `apps/server/src/__tests__/settler-env.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

describe('settler env config', () => {
  beforeEach(() => {
    process.env.SETTLER_ETH = '0xaaaa000000000000000000000000000000000001'
    process.env.SETTLER_BSC = '0xaaaa000000000000000000000000000000000002'
    process.env.SETTLER_INCENTIV = '0xaaaa000000000000000000000000000000000003'
    process.env.ALLOWANCE_HOLDER_ETH = '0xbbbb000000000000000000000000000000000001'
    process.env.ALLOWANCE_HOLDER_BSC = '0xbbbb000000000000000000000000000000000002'
    process.env.ALLOWANCE_HOLDER_INCENTIV = '0xbbbb000000000000000000000000000000000003'
    process.env.RPC_URL_ETH = 'https://example.invalid/eth'
  })

  it('exposes settler and allowance holder addresses per chain', async () => {
    const { appConfig } = await import('../config/app-config')
    expect(appConfig.settler.ethereum).toBe('0xaAaA000000000000000000000000000000000001')
    expect(appConfig.settler.bsc).toBe('0xAaAa000000000000000000000000000000000002')
    expect(appConfig.settler.incentiv).toBe('0xaAaa000000000000000000000000000000000003')
    expect(appConfig.allowanceHolder.ethereum).toBe('0xbbbB000000000000000000000000000000000001')
    expect(appConfig.permit2).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3')
  })
})
```

(Address checksum casing comes from viem's `getAddress`. The expected forms above are illustrative; let the test fail first, then copy the actual checksummed values into the assertion once `getAddress` is wired in Step 5.)

- [ ] **Step 3: Run the failing test**

Run:
```bash
cd apps/server && npx vitest run src/__tests__/settler-env.test.ts
```
Expected: FAIL — `appConfig.settler` does not exist.

- [ ] **Step 4: Add env entries to `apps/server/src/config/env.ts`**

In the existing Zod schema, after the existing executor entries (which will be removed in Plan 2, leave them for now to avoid breaking Plan 2's TDD), add:

```typescript
SETTLER_ETH: z.string().optional(),
SETTLER_BSC: z.string().optional(),
SETTLER_INCENTIV: z.string().optional(),
ALLOWANCE_HOLDER_ETH: z.string().optional(),
ALLOWANCE_HOLDER_BSC: z.string().optional(),
ALLOWANCE_HOLDER_INCENTIV: z.string().optional(),
```

- [ ] **Step 5: Add resolution to `app-config.ts`**

Add a hardcoded canonical-addresses constant block (from Task 7 Step 1 findings), then resolve overrides from env. Sketch:

```typescript
import { getAddress, type Address } from 'viem'

const CANONICAL_SETTLER: Record<'ethereum' | 'bsc', Address> = {
  ethereum: getAddress('0x<canonical-eth-settler>'),
  bsc: getAddress('0x<canonical-bsc-settler>'),
}
const CANONICAL_ALLOWANCE_HOLDER: Record<'ethereum' | 'bsc', Address> = {
  ethereum: getAddress('0x<canonical-eth-ah>'),
  bsc: getAddress('0x<canonical-bsc-ah>'),
}
const PERMIT2: Address = getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3')

const INCENTIV_SETTLER_DEFAULT = getAddress(
  // value from packages/contracts/ignition/deployments/chain-24101/settler-addresses.json
  '0x<deployed-incentiv-settler>'
)
const INCENTIV_ALLOWANCE_HOLDER_DEFAULT = getAddress(
  '0x<deployed-incentiv-ah>'
)

// Add to appConfig export:
settler: {
  ethereum: parseAddressOrNull(process.env.SETTLER_ETH) ?? CANONICAL_SETTLER.ethereum,
  bsc:      parseAddressOrNull(process.env.SETTLER_BSC) ?? CANONICAL_SETTLER.bsc,
  incentiv: parseAddressOrNull(process.env.SETTLER_INCENTIV) ?? INCENTIV_SETTLER_DEFAULT,
},
allowanceHolder: {
  ethereum: parseAddressOrNull(process.env.ALLOWANCE_HOLDER_ETH) ?? CANONICAL_ALLOWANCE_HOLDER.ethereum,
  bsc:      parseAddressOrNull(process.env.ALLOWANCE_HOLDER_BSC) ?? CANONICAL_ALLOWANCE_HOLDER.bsc,
  incentiv: parseAddressOrNull(process.env.ALLOWANCE_HOLDER_INCENTIV) ?? INCENTIV_ALLOWANCE_HOLDER_DEFAULT,
},
permit2: PERMIT2,
```

`parseAddressOrNull` already exists in `app-config.ts` (it normalizes via `getAddress`). Reuse it.

- [ ] **Step 6: Re-run the test, updating the expected checksum casing**

Run:
```bash
cd apps/server && npx vitest run src/__tests__/settler-env.test.ts
```

If the assertions fail because of checksum casing mismatch, edit the test to use the exact `getAddress(...)` outputs (don't change the implementation — viem checksums are authoritative).

Expected after fixing casing: PASS.

- [ ] **Step 7: Attach addresses per chain in `chains.ts`**

In each chain definition (ethereum, bsc, incentiv), add a new `settler` block referencing `appConfig.settler[key]` and `appConfig.allowanceHolder[key]` and `appConfig.permit2`. Concretely, in each chain object literal, add:

```typescript
settler: {
  settler: appConfig.settler.ethereum,           // adjust key per chain
  allowanceHolder: appConfig.allowanceHolder.ethereum,
  permit2: appConfig.permit2,
},
```

- [ ] **Step 8: Update `.env.example`**

Append a new section after the existing `# ─── Executor Contracts ───` block (do NOT remove the existing `AEQUI_EXECUTOR_*` lines yet — Plan 2 removes them):

```
# ─── 0x Settler Contracts (overrides canonical addresses) ─────
# SETTLER_ETH=
# SETTLER_BSC=
# SETTLER_INCENTIV=
# ALLOWANCE_HOLDER_ETH=
# ALLOWANCE_HOLDER_BSC=
# ALLOWANCE_HOLDER_INCENTIV=
```

- [ ] **Step 9: Run full server test suite**

Run:
```bash
cd apps/server && npx vitest run
```
Expected: all existing tests still pass, plus the new `settler-env.test.ts`.

- [ ] **Step 10: Commit**

Run from repo root:
```bash
git add apps/server/src/config/ apps/server/src/__tests__/settler-env.test.ts .env.example
git commit -m "feat(server): surface Settler/AllowanceHolder addresses through config"
```

---

## Task 8: Update CLAUDE.md and spec NOTES

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-05-26-plan-1-settler-infrastructure-NOTES.md`

- [ ] **Step 1: Add Settler section to CLAUDE.md**

Insert after the existing "Environment" section:

```markdown
## 0x Settler integration

- Vendored at `packages/contracts/lib/0x-settler/` (git submodule pointing to our fork's `aequi/incentiv-support` branch).
- Foundry project; build with `cd packages/contracts/lib/0x-settler && forge build`.
- Incentiv deployment lives at the addresses recorded in `packages/contracts/ignition/deployments/chain-24101/settler-addresses.json` — do not change without redeploying.
- Ethereum + BSC use 0x's canonical CREATE2 deployments (hardcoded in `apps/server/src/config/app-config.ts`).
- AequiExecutor is being phased out; see `docs/superpowers/specs/2026-05-26-settler-migration-design.md`.
```

- [ ] **Step 2: Finalize the NOTES file**

Open `docs/superpowers/plans/2026-05-26-plan-1-settler-infrastructure-NOTES.md` and add a final section:

```markdown
## Final deployed addresses (Incentiv)

| Contract         | Address |
|------------------|---------|
| Settler          | 0x... |
| SettlerMetaTxn   | 0x... |
| AllowanceHolder  | 0x... |
| Permit2          | 0x000000000022D473030F116dDEE9F6B43aC78BA3 (canonical, pre-deployed) |

Block: <block-number-of-deployment>
Deployed-at: <iso-timestamp>
Deployer EOA: <0x...>
Settler commit (our fork): <full SHA>
```

- [ ] **Step 3: Commit**

Run:
```bash
git add CLAUDE.md docs/superpowers/plans/2026-05-26-plan-1-settler-infrastructure-NOTES.md
git commit -m "docs: document Settler integration and Incentiv deployment"
```

---

## Verification (end of Plan 1)

Run this checklist before declaring Plan 1 done:

- [ ] `git submodule status packages/contracts/lib/0x-settler` shows our fork SHA, prefix `+` (in sync) or no prefix.
- [ ] `cd packages/contracts/lib/0x-settler && forge build` exits 0.
- [ ] `cast code <incentiv-settler-address> --rpc-url https://rpc.incentiv.io` returns non-empty bytecode.
- [ ] `cast code <incentiv-allowance-holder-address> --rpc-url https://rpc.incentiv.io` returns non-empty bytecode.
- [ ] `cd apps/server && npx vitest run` is green.
- [ ] `npm run check-types` from repo root is green.
- [ ] `packages/contracts/ignition/deployments/chain-24101/settler-addresses.json` has real, non-`null` `deployedAt`.

If all green: Plan 1 complete. Proceed to Plan 2 (core abstraction + DEX encoders).

---

## What Plan 1 deliberately does NOT do

- Does not touch `packages/core`, `packages/dex-adapters`, or any frontend code.
- Does not delete `AequiExecutor.sol` — that happens in Plan 2 once SettlerBackend produces valid calldata.
- Does not change `apps/server`'s swap controller; Plan 3 handles the request/response shape.
- Does not add Uniswap V4; Plan 4 handles it.
- Does not exercise Settler with real swap actions; that is implicit in Plan 2's snapshot tests + Plan 3's fork tests.
