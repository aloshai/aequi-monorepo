export enum ErrorCode {
  // Validation Errors (4xx)
  INVALID_REQUEST = 'invalid_request',
  INVALID_ADDRESS = 'invalid_address',
  INVALID_AMOUNT = 'invalid_amount',
  INVALID_CHAIN = 'invalid_chain',
  UNSUPPORTED_CHAIN = 'unsupported_chain',
  UNSUPPORTED_TOKEN = 'unsupported_token',
  
  // Route/Pricing Errors
  NO_ROUTE_FOUND = 'no_route_found',
  INSUFFICIENT_LIQUIDITY = 'insufficient_liquidity',
  PRICE_IMPACT_TOO_HIGH = 'price_impact_too_high',
  SLIPPAGE_EXCEEDED = 'slippage_exceeded',
  
  // RPC/Network Errors (5xx)
  RPC_ERROR = 'rpc_error',
  RPC_TIMEOUT = 'rpc_timeout',
  NETWORK_ERROR = 'network_error',
  
  // Contract Errors
  CONTRACT_ERROR = 'contract_error',
  EXECUTION_REVERTED = 'execution_reverted',
  INSUFFICIENT_BALANCE = 'insufficient_balance',
  INSUFFICIENT_ALLOWANCE = 'insufficient_allowance',
  
  // Quote Lifecycle Errors
  QUOTE_NOT_FOUND = 'quote_not_found',
  QUOTE_EXPIRED = 'quote_expired',
  QUOTE_MISMATCH = 'quote_mismatch',
  SIMULATION_FAILED = 'simulation_failed',
  
  // Configuration Errors
  MISSING_CONFIG = 'missing_config',
  INVALID_CONFIG = 'invalid_config',
  
  // Internal Errors
  INTERNAL_ERROR = 'internal_error',
  NOT_IMPLEMENTED = 'not_implemented',
}

export interface ErrorMetadata {
  [key: string]: unknown
  code: ErrorCode
  statusCode?: number
  retryable?: boolean
  chainId?: number
  chainName?: string
  tokenAddress?: string
  amount?: string
}

export class AequiError extends Error {
  public readonly code: ErrorCode
  public readonly statusCode: number
  public readonly retryable: boolean
  public readonly metadata: Record<string, unknown>
  public readonly timestamp: number

  constructor(
    message: string,
    code: ErrorCode,
    options: {
      statusCode?: number
      retryable?: boolean
      cause?: Error
      metadata?: Record<string, unknown>
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = this.constructor.name
    this.code = code
    this.statusCode = options.statusCode ?? 500
    this.retryable = options.retryable ?? false
    this.metadata = options.metadata ?? {}
    this.timestamp = Date.now()
    
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  toJSON() {
    const result: Record<string, unknown> = {
      error: this.code,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
      timestamp: this.timestamp,
      metadata: this.metadata,
    }
    
    if (this.cause) {
      result.cause = (this.cause as Error).message
    }
    
    return result
  }
}

export class ValidationError extends AequiError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, ErrorCode.INVALID_REQUEST, {
      statusCode: 400,
      retryable: false,
      metadata,
    })
  }
}

export class InvalidAddressError extends AequiError {
  constructor(address: string, metadata?: Record<string, unknown>) {
    super(`Invalid address: ${address}`, ErrorCode.INVALID_ADDRESS, {
      statusCode: 400,
      retryable: false,
      metadata: { ...metadata, address },
    })
  }
}

export class UnsupportedChainError extends AequiError {
  constructor(chainId: number | string, supportedChains: string[], metadata?: Record<string, unknown>) {
    super(
      `Unsupported chain '${chainId}'. Supported: ${supportedChains.join(', ')}`,
      ErrorCode.UNSUPPORTED_CHAIN,
      {
        statusCode: 400,
        retryable: false,
        metadata: { ...metadata, chainId, supportedChains },
      },
    )
  }
}

export class RouteNotFoundError extends AequiError {
  constructor(tokenA: string, tokenB: string, chainName: string, metadata?: Record<string, unknown>) {
    super(
      `No route found for ${tokenA} -> ${tokenB} on ${chainName}`,
      ErrorCode.NO_ROUTE_FOUND,
      {
        statusCode: 404,
        retryable: true,
        metadata: { ...metadata, tokenA, tokenB, chainName },
      },
    )
  }
}

export class InsufficientLiquidityError extends AequiError {
  constructor(tokenA: string, tokenB: string, amount: string, metadata?: Record<string, unknown>) {
    super(
      `Insufficient liquidity for ${amount} of ${tokenA} -> ${tokenB}`,
      ErrorCode.INSUFFICIENT_LIQUIDITY,
      {
        statusCode: 404,
        retryable: true,
        metadata: { ...metadata, tokenA, tokenB, amount },
      },
    )
  }
}

export class PriceImpactTooHighError extends AequiError {
  constructor(impactBps: number, maxBps: number, metadata?: Record<string, unknown>) {
    super(
      `Price impact ${impactBps / 100}% exceeds maximum ${maxBps / 100}%`,
      ErrorCode.PRICE_IMPACT_TOO_HIGH,
      {
        statusCode: 400,
        retryable: false,
        metadata: { ...metadata, impactBps, maxBps },
      },
    )
  }
}

export class RPCError extends AequiError {
  constructor(message: string, chainName: string, cause?: Error, metadata?: Record<string, unknown>) {
    super(`RPC error on ${chainName}: ${message}`, ErrorCode.RPC_ERROR, {
      statusCode: 503,
      retryable: true,
      cause,
      metadata: { ...metadata, chainName },
    })
  }
}

export class RPCTimeoutError extends AequiError {
  constructor(chainName: string, timeoutMs: number, metadata?: Record<string, unknown>) {
    super(`RPC timeout on ${chainName} after ${timeoutMs}ms`, ErrorCode.RPC_TIMEOUT, {
      statusCode: 504,
      retryable: true,
      metadata: { ...metadata, chainName, timeoutMs },
    })
  }
}

export class ContractExecutionError extends AequiError {
  constructor(message: string, contractAddress: string, cause?: Error, metadata?: Record<string, unknown>) {
    super(`Contract execution failed: ${message}`, ErrorCode.EXECUTION_REVERTED, {
      statusCode: 400,
      retryable: false,
      cause,
      metadata: { ...metadata, contractAddress },
    })
  }
}

export class InsufficientBalanceError extends AequiError {
  constructor(token: string, required: string, available: string, metadata?: Record<string, unknown>) {
    super(
      `Insufficient balance: required ${required}, available ${available} of ${token}`,
      ErrorCode.INSUFFICIENT_BALANCE,
      {
        statusCode: 400,
        retryable: false,
        metadata: { ...metadata, token, required, available },
      },
    )
  }
}

export class ConfigurationError extends AequiError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, ErrorCode.MISSING_CONFIG, {
      statusCode: 500,
      retryable: false,
      metadata,
    })
  }
}

export function isAequiError(error: unknown): error is AequiError {
  return error instanceof AequiError
}

export function toAequiError(error: unknown): AequiError {
  if (isAequiError(error)) {
    return error
  }

  if (error instanceof Error) {
    return new AequiError(error.message, ErrorCode.INTERNAL_ERROR, {
      statusCode: 500,
      retryable: false,
      cause: error,
    })
  }

  return new AequiError(
    typeof error === 'string' ? error : 'An unknown error occurred',
    ErrorCode.INTERNAL_ERROR,
    {
      statusCode: 500,
      retryable: false,
    },
  )
}
