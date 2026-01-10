import type { Abi } from 'viem'

export const V2_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swapExactTokensForTokens',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const satisfies Abi

export const V3_ROUTER_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'exactInput',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const satisfies Abi

export const V3_ROUTER02_ABI = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'exactInput',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
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

export const AEQUI_EXECUTOR_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'pulls',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
      },
      {
        name: 'approvals',
        type: 'tuple[]',
        components: [
          { name: 'token', type: 'address' },
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'revokeAfter', type: 'bool' },
        ],
      },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
          { name: 'injectToken', type: 'address' },
          { name: 'injectOffset', type: 'uint256' },
        ],
      },
      { name: 'tokensToFlush', type: 'address[]' },
    ],
    outputs: [{ name: 'results', type: 'bytes[]' }],
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

