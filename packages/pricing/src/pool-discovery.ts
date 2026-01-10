import { CurrencyAmount as CakeCurrencyAmount, Token as CakeToken } from '@pancakeswap/swap-sdk-core'
import { Pair as CakePair } from '@pancakeswap/v2-sdk'
import { Pool as CakePool } from '@pancakeswap/v3-sdk'
import { CurrencyAmount as UniCurrencyAmount, Token as UniToken } from '@uniswap/sdk-core'
import { Pair as UniPair } from '@uniswap/v2-sdk'
import { Pool as UniPool } from '@uniswap/v3-sdk'
import type { Address, PublicClient } from 'viem'
import type { ChainConfig, DexConfig, PriceQuote, RouteHopVersion, TokenMetadata } from '@aequi/core'
import { AEQUI_LENS_ABI } from '@aequi/core'
import { V2_FACTORY_ABI, V2_PAIR_ABI, V3_FACTORY_ABI, V3_POOL_ABI, V3_QUOTER_ABI, ZERO_ADDRESS, normalizeAddress, AEQUI_LENS_ADDRESSES, sameAddress } from './contracts'
import { minBigInt, multiplyQ18, scaleToQ18 } from './math'
import {
  computeExecutionPriceQ18,
  computeMidPriceQ18FromPrice,
  computeMidPriceQ18FromReserves,
  computePriceImpactBps,
  estimateAmountOutFromMidPrice,
  estimateGasForRoute,
  getV2AmountOut,
  toRawAmount,
} from './quote-math'
import { selectBestQuote } from './route-planner'
import type { ChainClientProvider, PoolDiscoveryConfig } from './types'
import type { TokenService } from './token-service'

interface V2ReserveSnapshot {
  pairAddress: Address
  reserveIn: bigint
  reserveOut: bigint
  reserve0: bigint
  reserve1: bigint
  token0: Address
  token1: Address
}

interface V3PoolSnapshot {
  poolAddress: Address
  sqrtPriceX96: bigint
  liquidity: bigint
  tick: number
  token0: Address
  token1: Address
  fee: number
}

export class PoolDiscovery {
  constructor(
    private readonly tokenService: TokenService,
    private readonly clientProvider: ChainClientProvider,
    private readonly config: PoolDiscoveryConfig,
  ) {}

  async fetchDirectQuotes(
    chain: ChainConfig,
    tokenIn: TokenMetadata,
    tokenOut: TokenMetadata,
    amountIn: bigint,
    gasPriceWei: bigint | null,
    client: PublicClient,
    allowedVersions: RouteHopVersion[],
  ): Promise<PriceQuote[]> {
    console.log(`[PoolDiscovery] Fetching direct quotes for ${tokenIn.symbol} -> ${tokenOut.symbol} (Amount: ${amountIn})`)
    const factoryCalls: any[] = []
    const dexMap: { type: 'v2' | 'v3'; dex: DexConfig; fee?: number; index: number }[] = []

    chain.dexes.forEach((dex) => {
      if (!allowedVersions.includes(dex.version)) return

      if (dex.version === 'v2') {
        factoryCalls.push({
          address: dex.factoryAddress,
          abi: V2_FACTORY_ABI,
          functionName: 'getPair',
          args: [tokenIn.address, tokenOut.address],
        })
        dexMap.push({ type: 'v2', dex, index: factoryCalls.length - 1 })
      } else {
        (dex.feeTiers ?? []).forEach((fee) => {
          factoryCalls.push({
            address: dex.factoryAddress,
            abi: V3_FACTORY_ABI,
            functionName: 'getPool',
            args: [tokenIn.address, tokenOut.address, fee],
          })
          dexMap.push({ type: 'v3', dex, fee, index: factoryCalls.length - 1 })
        })
      }
    })

    if (factoryCalls.length === 0) return []

    const factoryResults = await client.multicall({
      allowFailure: true,
      contracts: factoryCalls,
    })

    const poolsByType: {
      v2Pools: { poolAddress: Address; dex: DexConfig }[]
      v3Pools: { poolAddress: Address; dex: DexConfig; fee: number }[]
    } = { v2Pools: [], v3Pools: [] }

    dexMap.forEach((item) => {
      const result = factoryResults[item.index]
      if (!result || result.status !== 'success' || !result.result || result.result === ZERO_ADDRESS) return

      const poolAddress = result.result as Address

      if (item.type === 'v2') {
        poolsByType.v2Pools.push({ poolAddress, dex: item.dex })
      } else {
        poolsByType.v3Pools.push({ poolAddress, dex: item.dex, fee: item.fee! })
      }
    })

    const lensAddress = AEQUI_LENS_ADDRESSES[chain.id]
    let v2PoolData: Map<Address, { reserve0: bigint; reserve1: bigint; token0: Address; success: boolean }> = new Map()
    let v3PoolData: Map<Address, { sqrtPriceX96: bigint; tick: number; liquidity: bigint; token0: Address; token1: Address; success: boolean }> = new Map()

    console.log(`[PoolDiscovery] Chain ID: ${chain.id}, Lens address: ${lensAddress}, V2 pools: ${poolsByType.v2Pools.length}, V3 pools: ${poolsByType.v3Pools.length}`)

    if (lensAddress && poolsByType.v2Pools.length > 0) {
      v2PoolData = new Map()
      v3PoolData = new Map()

      if (poolsByType.v2Pools.length > 0) {
        try {
          const v2Addresses = poolsByType.v2Pools.map((p) => p.poolAddress)
          console.log(`[PoolDiscovery] Using AequiLens batch for ${v2Addresses.length} V2 pools`)
          const batchResult = await client.readContract({
            address: lensAddress,
            abi: AEQUI_LENS_ABI,
            functionName: 'batchGetV2PoolData',
            args: [v2Addresses],
          })

          batchResult.forEach((data: any, idx: number) => {
            const poolAddr = v2Addresses[idx]!
            v2PoolData.set(poolAddr, {
              reserve0: data.reserve0,
              reserve1: data.reserve1,
              token0: data.token0,
              success: data.exists,
            })
          })
        } catch (error) {
          console.warn(`[PoolDiscovery] AequiLens V2 batch failed, falling back to multicall:`, (error as Error).message)
        }
      }

      // V3 batch temporarily disabled due to revert issues - will investigate
      // if (poolsByType.v3Pools.length > 0) {
      //   try {
      //     const v3Addresses = poolsByType.v3Pools.map((p) => p.poolAddress)
      //     console.log(`[PoolDiscovery] Using AequiLens batch for ${v3Addresses.length} V3 pools`)
      //     const batchResult = await client.readContract({
      //       address: lensAddress,
      //       abi: AEQUI_LENS_ABI,
      //       functionName: 'batchGetV3PoolData',
      //       args: [v3Addresses],
      //     })
      //     ...
      //   } catch (error) {
      //     console.warn(`[PoolDiscovery] AequiLens V3 batch failed, falling back to multicall:`, (error as Error).message)
      //   }
      // }

      // Fallback to multicall for V3 pools
      if (poolsByType.v3Pools.length > 0) {
        console.log(`[PoolDiscovery] Using multicall for V3 pools (batch disabled)`)
        const poolDataCalls: any[] = []
        const poolMap: { poolAddress: Address; dex: DexConfig; fee: number; startIndex: number }[] = []

        poolsByType.v3Pools.forEach((item) => {
          poolDataCalls.push(
            { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'slot0' },
            { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'liquidity' },
            { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'token0' },
            { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'token1' },
          )
          poolMap.push({ poolAddress: item.poolAddress, dex: item.dex, fee: item.fee, startIndex: poolDataCalls.length - 4 })
        })

        const poolDataResults = await client.multicall({
          allowFailure: true,
          contracts: poolDataCalls,
        })

        poolMap.forEach((item) => {
          const slotRes = poolDataResults[item.startIndex]
          const liquidityRes = poolDataResults[item.startIndex + 1]
          const token0Res = poolDataResults[item.startIndex + 2]
          const token1Res = poolDataResults[item.startIndex + 3]

          if (slotRes && liquidityRes && token0Res && token1Res && 
              slotRes.status === 'success' && liquidityRes.status === 'success' &&
              token0Res.status === 'success' && token1Res.status === 'success') {
            const slotData = slotRes.result as readonly [bigint, number, number, number, number, number, boolean]
            const liquidityValue = liquidityRes.result as bigint
            const token0Address = normalizeAddress(token0Res.result as Address)
            const token1Address = normalizeAddress(token1Res.result as Address)

            v3PoolData.set(item.poolAddress, {
              sqrtPriceX96: slotData[0],
              tick: Number(slotData[1]),
              liquidity: liquidityValue,
              token0: token0Address,
              token1: token1Address,
              success: true,
            })
          }
        })
      }
    } else if (!lensAddress && (poolsByType.v2Pools.length > 0 || poolsByType.v3Pools.length > 0)) {
      console.log(`[PoolDiscovery] Falling back to multicall (lens address not found)`)
      const poolDataCalls: any[] = []
      const poolMap: {
        type: 'v2' | 'v3'
        dex: DexConfig
        fee?: number
        poolAddress: Address
        startIndex: number
      }[] = []

      poolsByType.v2Pools.forEach((item) => {
        poolDataCalls.push(
          { address: item.poolAddress, abi: V2_PAIR_ABI, functionName: 'getReserves' },
          { address: item.poolAddress, abi: V2_PAIR_ABI, functionName: 'token0' },
        )
        poolMap.push({ type: 'v2', dex: item.dex, poolAddress: item.poolAddress, startIndex: poolDataCalls.length - 2 })
      })

      poolsByType.v3Pools.forEach((item) => {
        poolDataCalls.push(
          { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'slot0' },
          { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'liquidity' },
          { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'token0' },
          { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'token1' },
        )
        poolMap.push({ type: 'v3', dex: item.dex, fee: item.fee, poolAddress: item.poolAddress, startIndex: poolDataCalls.length - 4 })
      })

      if (poolDataCalls.length === 0) return []

      const poolDataResults = await client.multicall({
        allowFailure: true,
        contracts: poolDataCalls,
      })

      v2PoolData = new Map()
      v3PoolData = new Map()

      poolMap.forEach((item) => {
        if (item.type === 'v2') {
          const reservesRes = poolDataResults[item.startIndex]
          const token0Res = poolDataResults[item.startIndex + 1]

          if (reservesRes && token0Res && reservesRes.status === 'success' && token0Res.status === 'success') {
            const [reserve0, reserve1] = reservesRes.result as readonly [bigint, bigint, number]
            const token0Address = normalizeAddress(token0Res.result as Address)
            v2PoolData.set(item.poolAddress, {
              reserve0,
              reserve1,
              token0: token0Address,
              success: true,
            })
          }
        } else {
          const slotRes = poolDataResults[item.startIndex]
          const liquidityRes = poolDataResults[item.startIndex + 1]
          const token0Res = poolDataResults[item.startIndex + 2]
          const token1Res = poolDataResults[item.startIndex + 3]

          if (slotRes && liquidityRes && token0Res && token1Res && 
              slotRes.status === 'success' && liquidityRes.status === 'success' &&
              token0Res.status === 'success' && token1Res.status === 'success') {
            const slotData = slotRes.result as readonly [bigint, number, number, number, number, number, boolean]
            const liquidityValue = liquidityRes.result as bigint
            const token0Address = normalizeAddress(token0Res.result as Address)
            const token1Address = normalizeAddress(token1Res.result as Address)

            v3PoolData.set(item.poolAddress, {
              sqrtPriceX96: slotData[0],
              tick: Number(slotData[1]),
              liquidity: liquidityValue,
              token0: token0Address,
              token1: token1Address,
              success: true,
            })
          }
        }
      })
    }

    const quotes: PriceQuote[] = []
    const v3Candidates: { dex: DexConfig; snapshot: V3PoolSnapshot }[] = []

    for (const item of poolsByType.v2Pools) {
      try {
        const poolData = v2PoolData.get(item.poolAddress)
        if (!poolData || !poolData.success) continue

        const reserveIn = sameAddress(poolData.token0, tokenIn.address)
          ? poolData.reserve0
          : poolData.reserve1
        const reserveOut = sameAddress(poolData.token0, tokenIn.address)
          ? poolData.reserve1
          : poolData.reserve0

        if (reserveIn < this.config.minV2ReserveThreshold || reserveOut < this.config.minV2ReserveThreshold) {
          continue
        }

        const amountOut = getV2AmountOut(amountIn, reserveIn, reserveOut)
        if (amountOut === 0n) continue

        const midPriceQ18 = computeMidPriceQ18FromReserves(
          item.dex.protocol,
          reserveIn,
          reserveOut,
          tokenIn.decimals,
          tokenOut.decimals,
        )
        const executionPriceQ18 = computeExecutionPriceQ18(amountIn, amountOut, tokenIn.decimals, tokenOut.decimals)
        const priceImpactBps = computePriceImpactBps(midPriceQ18, amountIn, amountOut, tokenIn.decimals, tokenOut.decimals)

        const hopVersions: RouteHopVersion[] = ['v2']
        const estimatedGasUnits = estimateGasForRoute(hopVersions)
        const estimatedGasCostWei = gasPriceWei ? gasPriceWei * estimatedGasUnits : null

        quotes.push({
          chain: chain.key,
          amountIn,
          amountOut,
          priceQ18: executionPriceQ18,
          executionPriceQ18,
          midPriceQ18,
          priceImpactBps,
          path: [tokenIn, tokenOut],
          routeAddresses: [tokenIn.address, tokenOut.address],
          sources: [
            {
              dexId: item.dex.id,
              poolAddress: item.poolAddress,
              amountIn,
              amountOut,
              reserves: {
                reserve0: poolData.reserve0,
                reserve1: poolData.reserve1,
                token0: poolData.token0,
                token1: sameAddress(poolData.token0, tokenIn.address) ? tokenOut.address : tokenIn.address,
              },
            },
          ],
          liquidityScore: reserveIn + reserveOut,
          hopVersions,
          estimatedGasUnits,
          estimatedGasCostWei,
          gasPriceWei,
        })
      } catch (error) {
        console.warn(`[PoolDiscovery] Error processing V2 pool ${item.poolAddress}:`, (error as Error).message)
      }
    }

    for (const item of poolsByType.v3Pools) {
      try {
        const poolData = v3PoolData.get(item.poolAddress)
        if (!poolData || !poolData.success) continue

        if (poolData.liquidity >= this.config.minV3LiquidityThreshold) {
          const snapshot: V3PoolSnapshot = {
            poolAddress: item.poolAddress,
            sqrtPriceX96: poolData.sqrtPriceX96,
            tick: poolData.tick,
            liquidity: poolData.liquidity,
            token0: poolData.token0,
            token1: poolData.token1,
            fee: item.fee,
          }
          v3Candidates.push({ dex: item.dex, snapshot })
        }
      } catch (error) {
        console.warn(`[PoolDiscovery] Error processing V3 pool ${item.poolAddress}:`, (error as Error).message)
      }
    }

    if (v3Candidates.length > 0) {
      const quoterCalls = v3Candidates.map((candidate) => {
        if (!candidate.dex.quoterAddress) {
          console.warn(`[PoolDiscovery] Missing quoter address for DEX ${candidate.dex.id}`)
          return null
        }
        return {
          address: candidate.dex.quoterAddress,
          abi: V3_QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [{
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            amountIn,
            fee: candidate.snapshot.fee,
            sqrtPriceLimitX96: 0n,
          }],
        }
      })

      const validCalls = quoterCalls.filter((call) => call !== null)
      if (validCalls.length > 0) {
        try {
          const quoterResults = await client.multicall({
            allowFailure: true,
            contracts: validCalls as any[],
          })

          let resultIndex = 0
          for (let i = 0; i < v3Candidates.length; i++) {
            const candidate = v3Candidates[i]!
            if (!candidate.dex.quoterAddress) continue

            const result = quoterResults[resultIndex]
            resultIndex++

            if (result && result.status === 'success') {
              const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = result.result as readonly [bigint, bigint, number, bigint]
              
              if (amountOut > 0n) {
                // Reconstruct quote from Quoter result
                const executionPriceQ18 = computeExecutionPriceQ18(amountIn, amountOut, tokenIn.decimals, tokenOut.decimals)
                // Mid price is approximate from slot0, but execution price is exact
                // We can use slot0 price for mid price
                const tokenInInstance = new UniToken(tokenIn.chainId, tokenIn.address, tokenIn.decimals, tokenIn.symbol, tokenIn.name)
                const tokenOutInstance = new UniToken(tokenOut.chainId, tokenOut.address, tokenOut.decimals, tokenOut.symbol, tokenOut.name)
                const pool = new UniPool(
                  tokenInInstance,
                  tokenOutInstance,
                  candidate.snapshot.fee,
                  candidate.snapshot.sqrtPriceX96.toString(),
                  candidate.snapshot.liquidity.toString(),
                  candidate.snapshot.tick
                )
                const midPriceQ18 = computeMidPriceQ18FromPrice(candidate.dex.protocol, tokenInInstance as any, tokenOut.decimals, pool.token0Price)
                
                const priceImpactBps = computePriceImpactBps(
                  midPriceQ18,
                  amountIn,
                  amountOut,
                  tokenIn.decimals,
                  tokenOut.decimals,
                )

                const hopVersions: RouteHopVersion[] = ['v3']
                const estimatedGasUnits = estimateGasForRoute(hopVersions) // Or use gasEstimate from quoter? Quoter gas is simulation gas, might be high.
                const estimatedGasCostWei = gasPriceWei ? gasPriceWei * estimatedGasUnits : null

                quotes.push({
                  chain: chain.key,
                  amountIn,
                  amountOut,
                  priceQ18: executionPriceQ18,
                  executionPriceQ18,
                  midPriceQ18,
                  priceImpactBps,
                  path: [tokenIn, tokenOut],
                  routeAddresses: [tokenIn.address, tokenOut.address],
                  sources: [
                    {
                      dexId: candidate.dex.id,
                      poolAddress: candidate.snapshot.poolAddress,
                      feeTier: candidate.snapshot.fee,
                      amountIn,
                      amountOut,
                      reserves: {
                        liquidity: candidate.snapshot.liquidity,
                        token0: candidate.snapshot.token0,
                        token1: candidate.snapshot.token1,
                      },
                    },
                  ],
                  liquidityScore: candidate.snapshot.liquidity,
                  hopVersions,
                  estimatedGasUnits,
                  estimatedGasCostWei,
                  gasPriceWei,
                })
              }
            } else {
               // Log failure if needed, but allowFailure=true handles it
               // console.warn(`[PoolDiscovery] Quoter failed for ${candidate.dex.id} pool ${candidate.snapshot.poolAddress}`)
            }
          }
        } catch (error) {
          console.warn(`[PoolDiscovery] Quoter multicall failed:`, (error as Error).message)
        }
      }
    }

    console.log(`[PoolDiscovery] Found ${quotes.length} direct quotes for ${tokenIn.symbol} -> ${tokenOut.symbol}`)
    return quotes
  }

  async fetchMultiHopQuotes(
    chain: ChainConfig,
    tokenIn: TokenMetadata,
    tokenOut: TokenMetadata,
    amountIn: bigint,
    gasPriceWei: bigint | null,
    client: PublicClient,
    allowedVersions: RouteHopVersion[],
  ): Promise<PriceQuote[]> {
    console.log(`[PoolDiscovery] Fetching multi-hop quotes for ${tokenIn.symbol} -> ${tokenOut.symbol}`)
    const intermediateAddresses = this.config.intermediateTokenAddresses[chain.key] ?? []
    const cache = new Map<string, TokenMetadata>()
    const results: PriceQuote[] = []

    for (const candidate of intermediateAddresses) {
      if (sameAddress(candidate, tokenIn.address) || sameAddress(candidate, tokenOut.address)) {
        continue
      }

      console.log(`[PoolDiscovery] Checking intermediate: ${candidate}`)
      const intermediate = await this.loadIntermediate(chain, candidate, cache)

      // Fetch quotes for Leg A (tokenIn -> intermediate) from ALL DEXes
      const legAQuotes = await this.fetchDirectQuotes(
        chain,
        tokenIn,
        intermediate,
        amountIn,
        gasPriceWei,
        client,
        allowedVersions,
      )

      // Try each legA quote as a starting point
      for (const legA of legAQuotes) {
        if (!legA || legA.amountOut === 0n) {
          continue
        }

        // Fetch quotes for Leg B (intermediate -> tokenOut) from ALL DEXes
        const legBQuotes = await this.fetchDirectQuotes(
          chain,
          intermediate,
          tokenOut,
          legA.amountOut,
          gasPriceWei,
          client,
          allowedVersions,
        )

        // Combine each legA with each legB (cross-DEX routing)
        for (const legB of legBQuotes) {
          if (!legB || legB.amountOut === 0n) {
            continue
          }

          const { mid, execution } = { 
            mid: multiplyQ18(legA.midPriceQ18, legB.midPriceQ18), 
            execution: multiplyQ18(legA.executionPriceQ18, legB.executionPriceQ18) 
          }
          
          // Sum individual hop price impacts instead of recalculating from combined price
          const combinedPriceImpactBps = legA.priceImpactBps + legB.priceImpactBps
          
          const hopVersions: RouteHopVersion[] = [...legA.hopVersions, ...legB.hopVersions]
          const estimatedGasUnits = estimateGasForRoute(hopVersions)
          const gasPrice = legA.gasPriceWei ?? legB.gasPriceWei ?? gasPriceWei
          const estimatedGasCostWei = gasPrice ? estimatedGasUnits * gasPrice : null

          results.push({
            chain: chain.key,
            amountIn,
            amountOut: legB.amountOut,
            priceQ18: execution,
            executionPriceQ18: execution,
            midPriceQ18: mid,
            priceImpactBps: combinedPriceImpactBps,
            path: [tokenIn, intermediate, tokenOut],
            routeAddresses: [tokenIn.address, intermediate.address, tokenOut.address],
            sources: [...legA.sources, ...legB.sources],
            liquidityScore: minBigInt(legA.liquidityScore, legB.liquidityScore),
            hopVersions,
            estimatedGasUnits,
            estimatedGasCostWei,
            gasPriceWei: gasPrice ?? null,
          })
        }
      }
    }

    console.log(`[PoolDiscovery] Found ${results.length} multi-hop quotes for ${tokenIn.symbol} -> ${tokenOut.symbol}`)
    return results
  }

  private async loadIntermediate(
    chain: ChainConfig,
    address: string,
    cache: Map<string, TokenMetadata>,
  ) {
    const lower = address.toLowerCase()
    const cached = cache.get(lower)
    if (cached) {
      return cached
    }
    const metadata = await this.tokenService.getTokenMetadata(chain, lower as Address)
    cache.set(lower, metadata)
    return metadata
  }

  private async computeV2Quote(
    chain: ChainConfig,
    dex: DexConfig,
    tokenIn: TokenMetadata,
    tokenOut: TokenMetadata,
    amountIn: bigint,
    gasPriceWei: bigint | null,
    snapshot: V2ReserveSnapshot,
  ): Promise<PriceQuote | null> {
    if (snapshot.reserveIn < this.config.minV2ReserveThreshold || snapshot.reserveOut < this.config.minV2ReserveThreshold) {
      return null
    }

    const { tokenInInstance, tokenOutInstance } = this.buildV2Tokens(dex, tokenIn, tokenOut)

    const reserveInAmount =
      dex.protocol === 'uniswap'
        ? UniCurrencyAmount.fromRawAmount(tokenInInstance as UniToken, snapshot.reserveIn.toString())
        : CakeCurrencyAmount.fromRawAmount(tokenInInstance as CakeToken, snapshot.reserveIn.toString())

    const reserveOutAmount =
      dex.protocol === 'uniswap'
        ? UniCurrencyAmount.fromRawAmount(tokenOutInstance as UniToken, snapshot.reserveOut.toString())
        : CakeCurrencyAmount.fromRawAmount(tokenOutInstance as CakeToken, snapshot.reserveOut.toString())

    const pair =
      dex.protocol === 'uniswap'
        ? new UniPair(reserveInAmount as any, reserveOutAmount as any)
        : new CakePair(reserveInAmount as any, reserveOutAmount as any)

    const inputAmount =
      dex.protocol === 'uniswap'
        ? UniCurrencyAmount.fromRawAmount(tokenInInstance as UniToken, amountIn.toString())
        : CakeCurrencyAmount.fromRawAmount(tokenInInstance as CakeToken, amountIn.toString())

    let amountOutRaw: bigint
    try {
      const [amountOutCurrency] = pair.getOutputAmount(inputAmount as any)
      amountOutRaw = toRawAmount(amountOutCurrency)
    } catch (error) {
      console.warn(`[PoolDiscovery] V2 quote failed for ${tokenIn.symbol}->${tokenOut.symbol}:`, (error as Error).message)
      return null
    }

    if (amountOutRaw <= 0n) {
      return null
    }

    const price = pair.priceOf(tokenInInstance as any)
    const midPriceQ18 = computeMidPriceQ18FromPrice(
      dex.protocol,
      tokenInInstance as any,
      tokenOut.decimals,
      price,
    )
    const executionPriceQ18 = computeExecutionPriceQ18(amountIn, amountOutRaw, tokenIn.decimals, tokenOut.decimals)
    const priceImpactBps = computePriceImpactBps(
      midPriceQ18,
      amountIn,
      amountOutRaw,
      tokenIn.decimals,
      tokenOut.decimals,
    )

    const liquidityScore = minBigInt(
      scaleToQ18(snapshot.reserveIn, tokenIn.decimals),
      scaleToQ18(snapshot.reserveOut, tokenOut.decimals),
    )

    const hopVersions: RouteHopVersion[] = ['v2']
    const estimatedGasUnits = estimateGasForRoute(hopVersions)
    const estimatedGasCostWei = gasPriceWei ? gasPriceWei * estimatedGasUnits : null

    return {
      chain: chain.key,
      amountIn,
      amountOut: amountOutRaw,
      priceQ18: executionPriceQ18,
      executionPriceQ18,
      midPriceQ18,
      priceImpactBps,
      path: [tokenIn, tokenOut],
      routeAddresses: [tokenIn.address, tokenOut.address],
      sources: [
        {
          dexId: dex.id,
          poolAddress: snapshot.pairAddress,
          amountIn,
          amountOut: amountOutRaw,
          reserves: {
            reserve0: snapshot.reserve0,
            reserve1: snapshot.reserve1,
            token0: snapshot.token0,
            token1: snapshot.token1,
          },
        },
      ],
      liquidityScore,
      hopVersions,
      estimatedGasUnits,
      estimatedGasCostWei,
      gasPriceWei,
    }
  }

  private async computeV3Quote(
    chain: ChainConfig,
    dex: DexConfig,
    tokenIn: TokenMetadata,
    tokenOut: TokenMetadata,
    amountIn: bigint,
    gasPriceWei: bigint | null,
    snapshot: V3PoolSnapshot,
  ): Promise<PriceQuote | null> {
    // V3 SDK-based quotes removed - use Quoter contract in fetchDirectQuotes instead
    // This method is now a placeholder and should not be called
    console.warn(`[PoolDiscovery] computeV3Quote called but V3 quotes should use Quoter contract`)
    return null
  }

  private buildV2Tokens(dex: DexConfig, tokenIn: TokenMetadata, tokenOut: TokenMetadata) {
    const tokenInInstance =
      dex.protocol === 'uniswap'
        ? new UniToken(tokenIn.chainId, tokenIn.address, tokenIn.decimals, tokenIn.symbol, tokenIn.name)
        : new CakeToken(tokenIn.chainId, tokenIn.address, tokenIn.decimals, tokenIn.symbol, tokenIn.name)

    const tokenOutInstance =
      dex.protocol === 'uniswap'
        ? new UniToken(tokenOut.chainId, tokenOut.address, tokenOut.decimals, tokenOut.symbol, tokenOut.name)
        : new CakeToken(tokenOut.chainId, tokenOut.address, tokenOut.decimals, tokenOut.symbol, tokenOut.name)

    return { tokenInInstance, tokenOutInstance }
  }
}
