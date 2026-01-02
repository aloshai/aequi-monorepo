# Aequi Monorepo AI Instructions

## Project Overview
Aequi is a decentralized exchange aggregator monorepo managed with Turbo.
- **apps/server**: Node.js/Fastify backend for route aggregation and transaction building.
- **apps/web**: React/Vite frontend for user interaction.
- **packages/contracts**: Solidity smart contracts (Hardhat) for atomic execution.

## Architecture & Key Patterns

### Server (`apps/server`)
- **Route Aggregation**: `ExchangeService` finds optimal paths across DEXs.
- **Transaction Building**: `SwapBuilder` (`src/services/transactions/swap-builder.ts`) constructs transactions.
  - **Direct Swap**: Interacts directly with a DEX router if only one pool is involved.
  - **Executor Swap**: Uses `AequiExecutor` for multi-hop/multi-dex swaps.
- **Chain Config**: `src/config/chains.ts` defines supported chains, RPCs, and DEX addresses.
- **Blockchain**: Uses `viem` for all server-side chain interactions.

### Contracts (`packages/contracts`)
- **AequiExecutor**: `contracts/AequiExecutor.sol` is the core execution contract.
  - **Pattern**: Pull funds -> Set Approvals -> Execute Calls -> Revoke Approvals -> Flush Leftovers.
  - **Statelessness**: Designed to hold no funds between transactions.

### Web (`apps/web`)
- **API Client**: `src/services/aequi-api.ts` handles backend communication.
- **Web3**: Uses `wagmi` for wallet connection and signing.
- **State**: React Query (via Wagmi) for blockchain state.

## Development Workflow

### Commands
- **Start All**: `npm run dev` (root) - Starts server and web.
- **Build**: `npx turbo build` (root).
- **Contracts**:
  - Compile: `npx hardhat compile` (in `packages/contracts`)
  - Test: `npx hardhat test` (in `packages/contracts`)
  - Deploy: `npx hardhat ignition deploy ...`

### Environment
- **Server**: Requires `.env` with `RPC_URL_*` and DEX addresses.
- **Web**: Requires `.env` for API URL and WalletConnect project ID.

## Coding Conventions
- **Imports**: Use absolute paths or alias imports where configured (check `tsconfig.json`).
- **Types**: Share types between server and web where possible, or keep strict DTO definitions in `types.ts`.
- **BigInt**: Use `bigint` for all token amounts; avoid `number` for precision.
- **Viem**: Prefer `viem` over `ethers.js` for server-side logic.

## Key Files
- `apps/server/src/index.ts`: API Entry point.
- `apps/server/src/services/transactions/swap-builder.ts`: Core swap logic.
- `packages/contracts/contracts/AequiExecutor.sol`: Execution contract.
- `apps/web/src/services/aequi-api.ts`: Frontend API definition.
