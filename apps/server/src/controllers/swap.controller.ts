import type { FastifyRequest, FastifyReply } from 'fastify'
import type { Address, Hex } from 'viem'
import { encodeAbiParameters, keccak256, pad, toHex } from 'viem'
import type { AppDeps } from '../deps'
import type { QuoteResult } from '../types'
import { SWAP_QUOTE_TTL_SECONDS } from '../config/constants'
import { swapBodySchema } from '../schemas/swap.schema'
import { resolveChain, resolveRoutePreference, resolveEffectiveTokens, formatPriceQuote } from '../utils/route-helpers'
import { normalizeAddress } from '../utils/trading'
import { formatAmountFromUnits, parseAmountToUnits } from '../utils/units'
import { decodeRevertReason } from '../utils/revert-decoder'
import { computeRecommendedSlippage } from '../services/quote/quote-service'

const COMMON_BALANCE_BASE_SLOTS = [0n, 2n, 3n, 51n, 101n]

function buildSimulationOverrides(
  holder: Address,
  inputToken: Address | null,
  spender: Address,
  amountIn: bigint,
) {
  const overrides: Array<{ address: Address; balance?: bigint; stateDiff?: Array<{ slot: Hex; value: Hex }> }> = [
    { address: holder, balance: 10n ** 24n },
  ]

  if (!inputToken) return overrides

  const balanceValue = pad(toHex(amountIn * 10n), { size: 32 })
  const maxAllowance = pad(toHex(2n ** 256n - 1n), { size: 32 })
  const diffs: Array<{ slot: Hex; value: Hex }> = []

  for (const baseSlot of COMMON_BALANCE_BASE_SLOTS) {
    diffs.push({
      slot: keccak256(encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256' }],
        [holder, baseSlot],
      )),
      value: balanceValue,
    })

    const innerHash = keccak256(encodeAbiParameters(
      [{ type: 'address' }, { type: 'uint256' }],
      [holder, baseSlot + 1n],
    ))
    diffs.push({
      slot: keccak256(encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes32' }],
        [spender, innerHash],
      )),
      value: maxAllowance,
    })
  }

  overrides.push({ address: inputToken, stateDiff: diffs })
  return overrides
}

export async function handleSwap(deps: AppDeps, request: FastifyRequest, reply: FastifyReply) {
  const parsed = swapBodySchema.safeParse(request.body)
  if (!parsed.success) {
    reply.status(400)
    return { error: 'invalid_request', details: parsed.error.flatten() }
  }

  let chain
  try {
    chain = resolveChain(parsed.data.chain)
  } catch (error) {
    reply.status(400)
    return { error: 'unsupported_chain', message: (error as Error).message }
  }

  const recipient = normalizeAddress(parsed.data.recipient)
  const { effectiveTokenA, effectiveTokenB, useNativeInput, useNativeOutput } =
    resolveEffectiveTokens(parsed.data.tokenA, parsed.data.tokenB, chain)
  const routePreference = resolveRoutePreference(parsed.data.version)

  if (normalizeAddress(parsed.data.tokenA).toLowerCase() === normalizeAddress(parsed.data.tokenB).toLowerCase()) {
    reply.status(400)
    return { error: 'invalid_request', message: 'tokenA and tokenB must be different' }
  }

  if (effectiveTokenA === effectiveTokenB) {
    reply.status(400)
    return { error: 'invalid_request', message: 'tokenA and tokenB resolve to the same token after native wrapping' }
  }

  const slippageInput = Number.isFinite(parsed.data.slippageBps) ? parsed.data.slippageBps! : undefined
  const swapSlippageBps = slippageInput ?? 50
  const deadlineSeconds = Number.isFinite(parsed.data.deadlineSeconds) ? parsed.data.deadlineSeconds! : 180
  const forceMultiHop = parsed.data.forceMultiHop ?? false
  const enableSplit = parsed.data.enableSplit !== false

  request.log.info({ tokenA: effectiveTokenA, tokenB: effectiveTokenB, amount: parsed.data.amount, quoteId: parsed.data.quoteId }, 'Swap request')

  let quoteResult: QuoteResult | null = null

  if (parsed.data.quoteId) {
    const stored = deps.quoteStore.consume(parsed.data.quoteId)
    if (!stored) {
      const isExpired = deps.quoteStore.isExpired(parsed.data.quoteId)
      reply.status(isExpired ? 410 : 404)
      return {
        error: isExpired ? 'quote_expired' : 'quote_not_found',
        message: isExpired
          ? 'Quote has expired — please request a new quote'
          : 'Quote not found — it may have already been used or expired',
      }
    }

    const storedTokenIn = stored.result.tokenIn.address.toLowerCase()
    const storedTokenOut = stored.result.tokenOut.address.toLowerCase()
    if (storedTokenIn !== effectiveTokenA || storedTokenOut !== effectiveTokenB) {
      reply.status(400)
      return { error: 'quote_mismatch', message: 'Quote tokens do not match request parameters' }
    }

    const storedAmountIn = stored.result.quote.amountIn.toString()
    const requestAmountIn = parseAmountToUnits(parsed.data.amount, stored.result.tokenIn.decimals).toString()
    if (storedAmountIn !== requestAmountIn) {
      reply.status(400)
      return { error: 'quote_mismatch', message: 'Quote amount does not match request parameters' }
    }

    quoteResult = stored.result
    request.log.info({ quoteId: parsed.data.quoteId }, 'Using stored quote')
  }

  if (!quoteResult) {
    try {
      quoteResult = await deps.quoteService.getQuote(
        chain, effectiveTokenA, effectiveTokenB, parsed.data.amount,
        swapSlippageBps, routePreference, forceMultiHop, enableSplit,
      )
    } catch (error) {
      reply.status(400)
      return { error: 'invalid_request', message: (error as Error).message }
    }
  }

  if (!quoteResult) {
    reply.status(404)
    return { error: 'no_route', message: 'No on-chain route found for the requested pair' }
  }

  const { quote, amountOutMin, tokenOut, slippageBps: boundedSlippage } = quoteResult

  let transaction
  try {
    transaction = deps.swapBuilder.build(chain, {
      quote, amountOutMin, recipient, slippageBps: boundedSlippage,
      deadlineSeconds, useNativeInput, useNativeOutput,
    })
  } catch (error) {
    reply.status(400)
    return { error: 'calldata_error', message: (error as Error).message }
  }

  let latestBlockNumber: bigint | null = null
  let latestBlockTimestamp: bigint | null = null
  let estimatedGas: bigint | undefined
  let simulationPassed = false

  try {
    const client = await deps.chainClientProvider.getClient(chain)
    const latestBlock = await client.getBlock()
    latestBlockNumber = latestBlock.number ?? null
    latestBlockTimestamp = latestBlock.timestamp ?? null

    if (transaction.call) {
      const stateOverride = buildSimulationOverrides(
        recipient, useNativeInput ? null : effectiveTokenA,
        transaction.spender, transaction.amountIn,
      )

      try {
        await client.call({
          account: recipient,
          to: transaction.call.to,
          data: transaction.call.data,
          value: transaction.call.value,
          stateOverride,
        })
        simulationPassed = true
      } catch (simError: any) {
        const revertData = simError?.data ?? simError?.cause?.data
        const decoded = decodeRevertReason(revertData)
        request.log.warn({ decoded }, 'Simulation reverted (non-blocking)')
      }

      try {
        estimatedGas = await client.estimateGas({
          account: recipient,
          to: transaction.call.to,
          data: transaction.call.data,
          value: transaction.call.value,
          stateOverride,
        })
        estimatedGas = (estimatedGas * 120n) / 100n
      } catch {
        if (simulationPassed) {
          const callCount = transaction.executor?.calls.length ?? 1
          estimatedGas = BigInt(200_000 + callCount * 200_000)
        }
      }
    }
  } catch (error) {
    request.log.warn({ err: error }, 'Failed to load block metadata or run simulation')
  }

  const quoteTimestamp = Math.floor(Date.now() / 1000)
  const quoteExpiresAt = quoteTimestamp + SWAP_QUOTE_TTL_SECONDS

  const baseResponse = formatPriceQuote(chain, quote, routePreference)
  const amountOutMinFormatted = formatAmountFromUnits(amountOutMin, tokenOut.decimals)
  const swapRecommended = computeRecommendedSlippage(quote)

  return {
    ...baseResponse,
    amountOutMin: amountOutMin.toString(),
    amountOutMinFormatted,
    slippageBps: boundedSlippage,
    recommendedSlippageBps: swapRecommended,
    recipient,
    deadline: transaction.deadline,
    quoteTimestamp,
    quoteExpiresAt,
    quoteValidSeconds: SWAP_QUOTE_TTL_SECONDS,
    quoteBlockNumber: latestBlockNumber ? latestBlockNumber.toString() : null,
    quoteBlockTimestamp: latestBlockTimestamp ? Number(latestBlockTimestamp) : null,
    simulationPassed,
    transaction: {
      kind: transaction.kind,
      dexId: transaction.dexId,
      router: transaction.router,
      spender: transaction.spender,
      amountIn: transaction.amountIn.toString(),
      amountOut: transaction.amountOut.toString(),
      amountOutMinimum: transaction.amountOutMinimum.toString(),
      deadline: transaction.deadline,
      calls: transaction.calls.map((call) => ({
        target: call.target,
        allowFailure: call.allowFailure,
        callData: call.callData,
        value: (call.value ?? 0n).toString(),
      })),
      call: transaction.call
        ? {
            to: transaction.call.to,
            data: transaction.call.data,
            value: transaction.call.value.toString(),
          }
        : null,
      executor: transaction.executor
        ? {
            pulls: transaction.executor.pulls.map((pull) => ({
              token: pull.token,
              amount: pull.amount.toString(),
            })),
            approvals: transaction.executor.approvals.map((approval) => ({
              token: approval.token,
              spender: approval.spender,
              amount: approval.amount.toString(),
              revokeAfter: approval.revokeAfter,
            })),
            calls: transaction.executor.calls.map((call) => ({
              target: call.target,
              value: call.value.toString(),
              data: call.data,
            })),
            tokensToFlush: transaction.executor.tokensToFlush,
          }
        : null,
      estimatedGas: estimatedGas?.toString(),
    },
  }
}
