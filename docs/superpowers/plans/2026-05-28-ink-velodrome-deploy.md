# Ink Velodrome — Deploy Checklist

When you come back, run these steps to finish the Ink Velodrome integration. The Aequi-side code is already merged into `feat/settler-migration`; the only remaining work is on-chain.

## What's already wired up

- ✅ Settler fork (`aloshai/0x-settler:aequi/ink-velodrome`) with Velodrome Slipstream support on Ink + a constructor bypass for chainId 57073 (so we can deploy standalone, outside 0x's Deployer registry).
- ✅ Outer submodule pointer in `feat/settler-migration` tracks the fork at commit `6651cc35`.
- ✅ `script/DeployAequiInk.s.sol` ready in the fork — deploys both `InkSettler` and `InkSettlerMetaTxn`.
- ✅ Aequi side: `VelodromeSlipstreamAdapter`, pool-discovery Slipstream probe path, `velodrome-slipstream` registered in `dexIdToSettlerForkId` (forkId 4), Velodrome dex entry added to `CHAIN_CONFIGS.ink`.
- ✅ Defaults for `appConfig.settler.byChain.ink` point at 0x's official Settler (Uniswap V4 routing only). Velodrome routing activates as soon as `SETTLER_INK` env points at the fork deployment.

## On-chain deploy (your turn)

### 1. Fund the deployer EOA on Ink

You need a tiny amount of ETH on Ink (OP Stack L2, deploys are cheap). Estimate: 0.001 ETH covers both contract deploys comfortably.

Bridge options:
- Native: https://relay.link/bridge?toChainId=57073
- Or CEX withdrawal directly to Ink

### 2. Run the deploy from WSL

WSL Ubuntu has Foundry installed (`~/.foundry/bin/forge`). Submodules are fully initialized — Windows `MAX_PATH` doesn't bite from WSL.

```bash
cd /mnt/c/Users/alosh/source/aequi-monorepo/packages/contracts/lib/0x-settler
export PATH="$HOME/.foundry/bin:$PATH"
export INK_DEPLOYER_PK=0x...   # your funded Ink EOA private key

forge script script/DeployAequiInk.s.sol \
  --rpc-url https://rpc-gel.inkonchain.com \
  --private-key "$INK_DEPLOYER_PK" \
  --broadcast \
  -vvv
```

The script prints two addresses at the end:

```
InkSettler        : 0x<NEW_ADDR_1>
InkSettlerMetaTxn : 0x<NEW_ADDR_2>
```

Save both.

### 3. Push the addresses to staging

Update the staging compose env on Dokploy (project: Aequi, environment: staging-settler, composeId: `whduOtYMKw4VdTnt6LouU`). Append/replace:

```
SETTLER_INK=0x<NEW_ADDR_1>
SETTLER_META_TXN_INK=0x<NEW_ADDR_2>
```

Or via API:

```bash
curl -X POST -H "x-api-key: $DOKPLOY_KEY" -H "Content-Type: application/json" \
  https://dokploy.alosha.me/api/compose.saveEnvironment \
  -d "{\"composeId\":\"whduOtYMKw4VdTnt6LouU\",\"env\":\"...<full env with SETTLER_INK appended>...\"}"
```

Then `compose.redeploy` to pick it up.

### 4. Verify live

After the redeploy:

```bash
# Should show 2 dexes: uniswap-v4 and velodrome-slipstream
curl -s "https://settler-api.alosha.me/exchange?chain=ink" | python -m json.tool

# Live swap — should now route via Velodrome (better liquidity)
curl -s -X POST -H "Content-Type: application/json" "https://settler-api.alosha.me/swap" -d '{
  "chain":"ink",
  "tokenA":"0x4200000000000000000000000000000000000006",
  "tokenB":"0xF1815bd50389c46847f0Bda824eC8da914045D14",
  "amount":"0.01",
  "slippageBps":100,
  "recipient":"0x000000000000000000000000000000000000DeaD",
  "tokenFlow":"settler-allowance-holder"
}'
```

Expected response: `source: velodrome-slipstream@<tickSpacing>`, non-zero `amountOut`, `router` field = your new Settler address.

### 5. (Optional) Hardcode the addresses in code

Once verified, update `apps/server/src/config/app-config.ts`:

```ts
inkSettler: '0x<NEW_ADDR_1>' as Address,
inkSettlerMetaTxn: '0x<NEW_ADDR_2>' as Address,
```

Then the env override becomes unnecessary; commit + push.

## If the deploy reverts

Most likely: chainId mismatch (constructor's `block.chainid == 57073` check). Verify with `cast chain-id --rpc-url https://rpc-gel.inkonchain.com` — should be `57073`.

If `OutOfFunds`: top up the deployer EOA.

If a different revert: paste the trace; we likely need to extend the bypass to cover another invariant.

## Maintenance going forward

Our Settler fork tracks `aloshai/0x-settler:aequi/ink-velodrome`. When 0x ships a new upstream release with relevant updates:

```bash
cd /mnt/c/Users/alosh/source/aequi-monorepo/packages/contracts/lib/0x-settler
git fetch upstream
git rebase upstream/master   # merge conflicts likely in SettlerBase.sol — keep our Ink bypass
forge build src/chains/Ink/  # verify
# Re-deploy if needed; bump submodule pointer in outer repo
```

The patches are minimal (two files: `SettlerBase.sol` constructor + `chains/Ink/Common.sol` Velodrome dispatch + `core/univ3forks/VelodromeSlipstream.sol` Ink constants), so rebases should stay manageable.
