# Aequi Contracts

Smart contracts for the Aequi protocol.

## Contracts

### AequiExecutor

Stateless multicall executor for atomic multi-hop swap sequences.

### Functionality

**Execution Flow**:
```solidity
function execute(
    TokenPull[] pulls,      // tokens to pull from sender
    Approval[] approvals,   // approvals to grant (with revoke flag)
    Call[] calls,           // external calls to execute
    address[] tokensToFlush // tokens to return to sender
) external payable
```

1. Pulls tokens from user wallet via `transferFrom`
2. Grants approvals to target contracts (e.g., DEX routers)
3. Executes calls with dynamic amount injection
4. Revokes approvals if `revokeAfter` flag set
5. Flushes output tokens back to sender

### Features

**Dynamic Injection**: Injects current token balances into calldata at runtime
- `injectToken`: token address to query balance
- `injectOffset`: byte offset in calldata to overwrite

**Balance Delta Tracking**: Snapshots balances before execution, returns increases after

**Security**:
- `ReentrancyGuard`: prevents reentrant calls
- `Pausable`: emergency stop mechanism
- `Ownable2Step`: safe ownership transfer
- Approval revocation after use

**Gas Optimizations**:
- Unchecked loop increments
- Minimal storage operations
- No unnecessary events

### Admin Functions
- `pause()` / `unpause()`: emergency controls
- `rescueFunds()` / `rescueETH()`: recover stuck assets

### AequiLens

Batch data query contract for efficient pool discovery.

**Functionality**:

```solidity
function batchGetV2PoolData(address[] pools) 
    returns (V2PoolData[] memory)

function batchGetV3PoolData(address[] pools)
    returns (V3PoolData[] memory)
```

**Features**:
- Batch queries for V2 pool reserves and token addresses
- Batch queries for V3 pool slot0, liquidity, and token addresses
- Graceful handling of invalid/non-existent pools
- Gas-efficient: Single call for multiple pools

**Usage**:
Integrated into `@aequi/pricing` PoolDiscovery for optimized pool data fetching. Falls back to standard multicall if not deployed.

**Deployment**:
```bash
npx hardhat ignition deploy ignition/modules/AequiLens.js --network <network_name>
```

## Tech Stack

- **Framework**: [Hardhat](https://hardhat.org/)
- **Language**: Solidity ^0.8.24

## Getting Started

### Installation

```bash
# Install dependencies (from root)
bun install
```

### Compilation

```bash
npx hardhat compile
```

### Testing

```bash
npx hardhat test
```

### Deployment

Deployment is managed via Hardhat Ignition.

```bash
npx hardhat ignition deploy ignition/modules/AequiExecutor.js --network <network_name>
```

## License

MIT
