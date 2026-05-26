import type { Abi } from 'viem'

/** AllowanceHolder.exec — the entrypoint for AllowanceHolder-mode Settler swaps. */
export const ALLOWANCE_HOLDER_ABI = [
  {
    type: 'function',
    name: 'exec',
    stateMutability: 'payable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'result', type: 'bytes' }],
  },
] as const satisfies Abi

/** Settler.execute — the action-dispatch entry point. */
export const SETTLER_EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'slippage',
        type: 'tuple',
        components: [
          { name: 'recipient', type: 'address' },
          { name: 'buyToken', type: 'address' },
          { name: 'minAmountOut', type: 'uint256' },
        ],
      },
      { name: 'actions', type: 'bytes[]' },
      { name: 'zid', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const satisfies Abi

/**
 * SettlerMetaTxn.executeMetaTxn — Permit2-mode entry point.
 *
 * The user signs a Permit2 `PermitWitnessTransferFrom` whose witness is the
 * `SlippageAndActions` tuple `(recipient, buyToken, minAmountOut, actions)`.
 * The signature is consumed by the first VIP action in `actions`
 * (typically METATXN_TRANSFER_FROM, which pulls the input tokens).
 */
export const SETTLER_META_TXN_ABI = [
  {
    type: 'function',
    name: 'executeMetaTxn',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'slippage',
        type: 'tuple',
        components: [
          { name: 'recipient', type: 'address' },
          { name: 'buyToken', type: 'address' },
          { name: 'minAmountOut', type: 'uint256' },
        ],
      },
      { name: 'actions', type: 'bytes[]' },
      { name: 'zid', type: 'bytes32' },
      { name: 'msgSender', type: 'address' },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const satisfies Abi

export const V3_QUOTER_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const satisfies Abi

export const WETH_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
] as const satisfies Abi

export const AEQUI_LENS_ABI = [
  {
    type: 'function',
    name: 'batchGetV2PoolData',
    stateMutability: 'view',
    inputs: [{ name: 'pairs', type: 'address[]' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'pairAddress', type: 'address' },
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'reserve0', type: 'uint112' },
          { name: 'reserve1', type: 'uint112' },
          { name: 'blockTimestampLast', type: 'uint32' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'batchGetV3PoolData',
    stateMutability: 'view',
    inputs: [{ name: 'pools', type: 'address[]' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'poolAddress', type: 'address' },
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceX96', type: 'uint160' },
          { name: 'tick', type: 'int24' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'batchGetTokenMetadata',
    stateMutability: 'view',
    inputs: [{ name: 'tokens', type: 'address[]' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'tokenAddress', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'decimals', type: 'uint8' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'exists', type: 'bool' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'batchCheckTokenBalances',
    stateMutability: 'view',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'batchCheckAllowances',
    stateMutability: 'view',
    inputs: [
      { name: 'tokens', type: 'address[]' },
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
] as const satisfies Abi

