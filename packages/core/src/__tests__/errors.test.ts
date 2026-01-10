import { describe, it, expect } from 'vitest'
import {
  AequiError,
  ValidationError,
  RouteNotFoundError,
  RPCError,
  ErrorCode,
  isAequiError,
  toAequiError,
} from '../src/errors'

describe('AequiError', () => {
  it('should create error with correct properties', () => {
    const error = new AequiError('Test error', ErrorCode.INTERNAL_ERROR, {
      statusCode: 500,
      retryable: false,
      metadata: { foo: 'bar' },
    })

    expect(error.message).toBe('Test error')
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(false)
    expect(error.metadata).toEqual({ foo: 'bar' })
    expect(error.timestamp).toBeGreaterThan(0)
  })

  it('should serialize to JSON correctly', () => {
    const error = new AequiError('Test error', ErrorCode.INVALID_REQUEST, {
      statusCode: 400,
      metadata: { field: 'tokenA' },
    })

    const json = error.toJSON()

    expect(json).toMatchObject({
      error: ErrorCode.INVALID_REQUEST,
      message: 'Test error',
      statusCode: 400,
      retryable: false,
      metadata: { field: 'tokenA' },
    })
    expect(json.timestamp).toBeGreaterThan(0)
  })

  it('should include cause in JSON when present', () => {
    const cause = new Error('Original error')
    const error = new AequiError('Wrapped error', ErrorCode.RPC_ERROR, {
      cause,
    })

    const json = error.toJSON()
    expect(json.cause).toBe('Original error')
  })
})

describe('ValidationError', () => {
  it('should create validation error with 400 status', () => {
    const error = new ValidationError('Invalid input', { field: 'amount' })

    expect(error.code).toBe(ErrorCode.INVALID_REQUEST)
    expect(error.statusCode).toBe(400)
    expect(error.retryable).toBe(false)
    expect(error.metadata.field).toBe('amount')
  })
})

describe('RouteNotFoundError', () => {
  it('should create route not found error', () => {
    const error = new RouteNotFoundError('WETH', 'USDC', 'ethereum')

    expect(error.message).toContain('WETH')
    expect(error.message).toContain('USDC')
    expect(error.message).toContain('ethereum')
    expect(error.code).toBe(ErrorCode.NO_ROUTE_FOUND)
    expect(error.statusCode).toBe(404)
    expect(error.retryable).toBe(true)
  })
})

describe('RPCError', () => {
  it('should create RPC error with retryable flag', () => {
    const error = new RPCError('Connection timeout', 'bsc')

    expect(error.message).toContain('Connection timeout')
    expect(error.message).toContain('bsc')
    expect(error.code).toBe(ErrorCode.RPC_ERROR)
    expect(error.statusCode).toBe(503)
    expect(error.retryable).toBe(true)
  })
})

describe('isAequiError', () => {
  it('should return true for AequiError instances', () => {
    const error = new ValidationError('Test')
    expect(isAequiError(error)).toBe(true)
  })

  it('should return false for standard Error', () => {
    const error = new Error('Test')
    expect(isAequiError(error)).toBe(false)
  })

  it('should return false for non-error values', () => {
    expect(isAequiError('string')).toBe(false)
    expect(isAequiError(null)).toBe(false)
    expect(isAequiError(undefined)).toBe(false)
  })
})

describe('toAequiError', () => {
  it('should return AequiError as-is', () => {
    const original = new ValidationError('Test')
    const converted = toAequiError(original)
    expect(converted).toBe(original)
  })

  it('should wrap standard Error', () => {
    const original = new Error('Standard error')
    const converted = toAequiError(original)

    expect(converted).toBeInstanceOf(AequiError)
    expect(converted.message).toBe('Standard error')
    expect(converted.code).toBe(ErrorCode.INTERNAL_ERROR)
    expect(converted.cause).toBe(original)
  })

  it('should convert string to AequiError', () => {
    const converted = toAequiError('Error message')

    expect(converted).toBeInstanceOf(AequiError)
    expect(converted.message).toBe('Error message')
    expect(converted.code).toBe(ErrorCode.INTERNAL_ERROR)
  })

  it('should handle unknown types', () => {
    const converted = toAequiError({ foo: 'bar' })

    expect(converted).toBeInstanceOf(AequiError)
    expect(converted.message).toBe('An unknown error occurred')
    expect(converted.code).toBe(ErrorCode.INTERNAL_ERROR)
  })
})
