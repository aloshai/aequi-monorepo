import type { Address, PublicClient } from 'viem'
import type { ChainConfig, DexConfig, PriceQuote, RouteHopVersion, TokenMetadata } from '@aequi/core'
import { AEQUI_LENS_ABI } from '@aequi/core'
import { V2_FACTORY_ABI, V2_PAIR_ABI, V3_FACTORY_ABI, V3_POOL_ABI, ZERO_ADDRESS, normalizeAddress, AEQUI_LENS_ADDRESSES, sameAddress } from './contracts'
import { minBigInt, multiplyQ18 } from './math'
import { estimateGasForRoute } from './quote-math'
import { selectBestQuote } from './route-planner'
import type { ChainClientProvider, PoolDiscoveryConfig } from './types'
import type { TokenService } from './token-service'
import { dexRegistry } from './dex-adapters/registry'

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
  ) { }

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

      if (poolsByType.v3Pools.length > 0) {
        try {
          const v3Addresses = poolsByType.v3Pools.map((p) => p.poolAddress)
          console.log(`[PoolDiscovery] Using AequiLens batch for ${v3Addresses.length} V3 pools`)
          const batchResult = await client.readContract({
            address: lensAddress,
            abi: AEQUI_LENS_ABI,
            functionName: 'batchGetV3PoolData',
            args: [v3Addresses],
          })

          batchResult.forEach((data: any, idx: number) => {
            const poolAddr = v3Addresses[idx]!
            v3PoolData.set(poolAddr, {
              sqrtPriceX96: data.sqrtPriceX96,
              tick: Number(data.tick),
              liquidity: data.liquidity,
              token0: data.token0,
              token1: data.token1,
              success: data.exists,
            })
          })
        } catch (error) {
          console.warn(`[PoolDiscovery] AequiLens V3 batch failed, falling back to multicall:`, (error as Error).message)

          // Fallback to multicall
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

        const adapter = dexRegistry.get(item.dex.protocol, 'v2')
        if (!adapter) {
          console.warn(`[PoolDiscovery] No adapter found for ${item.dex.protocol} V2`)
          continue
        }

        const quote = await adapter.computeV2Quote!({
          chainId: chain.id,
          chainKey: chain.key,
          dex: item.dex,
          tokenIn,
          tokenOut,
          amountIn,
          poolAddress: item.poolAddress,
          reserve0: poolData.reserve0,
          reserve1: poolData.reserve1,
          token0: poolData.token0,
          gasPriceWei,
          minReserveThreshold: this.config.minV2ReserveThreshold,
        })

        if (quote) {
          quotes.push(quote)
        }
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
      const quotePromises = v3Candidates.map(async (candidate) => {
        try {
          const adapter = dexRegistry.get(candidate.dex.protocol, 'v3')
          if (!adapter) {
            console.warn(`[PoolDiscovery] No adapter found for ${candidate.dex.protocol} V3`)
            return null
          }

          return await adapter.computeV3Quote!({
            chainId: chain.id,
            chainKey: chain.key,
            dex: candidate.dex,
            tokenIn,
            tokenOut,
            amountIn,
            poolAddress: candidate.snapshot.poolAddress,
            sqrtPriceX96: candidate.snapshot.sqrtPriceX96,
            liquidity: candidate.snapshot.liquidity,
            tick: candidate.snapshot.tick,
            fee: candidate.snapshot.fee,
            token0: candidate.snapshot.token0,
            token1: candidate.snapshot.token1,
            gasPriceWei,
            client,
          })
        } catch (error) {
          console.warn(`[PoolDiscovery] Error processing V3 pool ${candidate.snapshot.poolAddress}:`, (error as Error).message)
          return null
        }
      })

      const v3Quotes = await Promise.all(quotePromises)
      v3Quotes.forEach(quote => {
        if (quote) quotes.push(quote)
      })
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

    // Filter out input/output tokens
    const validCandidates = intermediateAddresses.filter(
      (candidate) => !sameAddress(candidate, tokenIn.address) && !sameAddress(candidate, tokenOut.address)
    )

    if (validCandidates.length === 0) {
      return []
    }

    // Batch fetch all intermediate token metadata
    console.log(`[PoolDiscovery] Batch fetching ${validCandidates.length} intermediate token metadata`)
    const intermediateTokens = await this.tokenService.getBatchTokenMetadata(
      chain,
      validCandidates as Address[]
    )

    // Fetch all legA quotes in parallel
    console.log(`[PoolDiscovery] Fetching leg A quotes for ${intermediateTokens.length} intermediates`)
    const legAQuotesArray = await Promise.all(
      intermediateTokens.map((intermediate) =>
        this.fetchDirectQuotes(chain, tokenIn, intermediate, amountIn, gasPriceWei, client, allowedVersions)
      )
    )

    const results: PriceQuote[] = []

    // Process each intermediate token
    for (let i = 0; i < intermediateTokens.length; i++) {
      const intermediate = intermediateTokens[i]!
      const legAQuotes = legAQuotesArray[i]!

      if (legAQuotes.length === 0) continue

      // Collect all unique amountOuts from legA for batch fetching legB
      const uniqueAmounts = new Set<bigint>()
      legAQuotes.forEach((legA) => {
        if (legA && legA.amountOut > 0n) {
          uniqueAmounts.add(legA.amountOut)
        }
      })

      // For simplicity, use the first legA's amountOut or fetch multiple in parallel
      // Here we'll fetch legB quotes for each legA in parallel
      const legBQuotesArray = await Promise.all(
        legAQuotes.map((legA) => {
          if (!legA || legA.amountOut === 0n) {
            return Promise.resolve([])
          }
          return this.fetchDirectQuotes(
            chain,
            intermediate,
            tokenOut,
            legA.amountOut,
            gasPriceWei,
            client,
            allowedVersions
          )
        })
      )

      // Combine legA and legB quotes
      for (let j = 0; j < legAQuotes.length; j++) {
        const legA = legAQuotes[j]
        const legBQuotes = legBQuotesArray[j]

        if (!legA || legA.amountOut === 0n || !legBQuotes) continue

        for (const legB of legBQuotes) {
          if (!legB || legB.amountOut === 0n) continue

          const { mid, execution } = {
            mid: multiplyQ18(legA.midPriceQ18, legB.midPriceQ18),
            execution: multiplyQ18(legA.executionPriceQ18, legB.executionPriceQ18)
          }

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
}
