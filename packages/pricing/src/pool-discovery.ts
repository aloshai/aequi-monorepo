import type { Address, PublicClient } from 'viem'
import type { ChainConfig, DexConfig, PriceQuote, PriceSource, RouteHopVersion, TokenMetadata } from '@aequi/core'
import { AEQUI_LENS_ABI } from '@aequi/core'
import { V2_FACTORY_ABI, V2_PAIR_ABI, V3_FACTORY_ABI, V3_POOL_ABI, ZERO_ADDRESS, normalizeAddress, AEQUI_LENS_ADDRESSES, sameAddress } from './contracts'
import { minBigInt, multiplyQ18, chainMultiplyQ18 } from './math'
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

    if (lensAddress && (poolsByType.v2Pools.length > 0 || poolsByType.v3Pools.length > 0)) {
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

          const failedV3Pools: typeof poolsByType.v3Pools = []

          batchResult.forEach((data: any, idx: number) => {
            const poolAddr = v3Addresses[idx]!
            if (data.exists) {
              v3PoolData.set(poolAddr, {
                sqrtPriceX96: data.sqrtPriceX96,
                tick: Number(data.tick),
                liquidity: data.liquidity,
                token0: data.token0,
                token1: data.token1,
                success: true,
              })
            } else {
              failedV3Pools.push(poolsByType.v3Pools[idx]!)
            }
          })

          if (failedV3Pools.length > 0) {
            console.log(`[PoolDiscovery] AequiLens returned exists=false for ${failedV3Pools.length} V3 pools, re-fetching via multicall`)
            await this.fetchV3PoolDataViaMulticall(failedV3Pools, v3PoolData, client)
          }
        } catch (error) {
          console.warn(`[PoolDiscovery] AequiLens V3 batch failed, falling back to multicall:`, (error as Error).message)
          await this.fetchV3PoolDataViaMulticall(poolsByType.v3Pools, v3PoolData, client)
        }
      }
    } else if (!lensAddress && (poolsByType.v2Pools.length > 0 || poolsByType.v3Pools.length > 0)) {
      console.log(`[PoolDiscovery] Falling back to multicall (lens address not found)`)

      v2PoolData = new Map()
      v3PoolData = new Map()

      if (poolsByType.v2Pools.length > 0) {
        const poolDataCalls: any[] = []
        const poolMap: { poolAddress: Address; startIndex: number }[] = []

        poolsByType.v2Pools.forEach((item) => {
          poolDataCalls.push(
            { address: item.poolAddress, abi: V2_PAIR_ABI, functionName: 'getReserves' },
            { address: item.poolAddress, abi: V2_PAIR_ABI, functionName: 'token0' },
          )
          poolMap.push({ poolAddress: item.poolAddress, startIndex: poolDataCalls.length - 2 })
        })

        const poolDataResults = await client.multicall({
          allowFailure: true,
          contracts: poolDataCalls,
        })

        poolMap.forEach((item) => {
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
        })
      }

      if (poolsByType.v3Pools.length > 0) {
        await this.fetchV3PoolDataViaMulticall(poolsByType.v3Pools, v3PoolData, client)
      }
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

  private async fetchV3PoolDataViaMulticall(
    pools: { poolAddress: Address; dex: DexConfig; fee: number }[],
    v3PoolData: Map<Address, { sqrtPriceX96: bigint; tick: number; liquidity: bigint; token0: Address; token1: Address; success: boolean }>,
    client: PublicClient,
  ): Promise<void> {
    if (pools.length === 0) return

    const poolDataCalls: any[] = []
    const poolMap: { poolAddress: Address; fee: number; startIndex: number }[] = []

    pools.forEach((item) => {
      poolDataCalls.push(
        { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'slot0' },
        { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'liquidity' },
        { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'token0' },
        { address: item.poolAddress, abi: V3_POOL_ABI, functionName: 'token1' },
      )
      poolMap.push({ poolAddress: item.poolAddress, fee: item.fee, startIndex: poolDataCalls.length - 4 })
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

  async fetchMultiHopQuotes(
    chain: ChainConfig,
    tokenIn: TokenMetadata,
    tokenOut: TokenMetadata,
    amountIn: bigint,
    gasPriceWei: bigint | null,
    client: PublicClient,
    allowedVersions: RouteHopVersion[],
  ): Promise<PriceQuote[]> {
    const maxDepth = Math.min(Math.max(this.config.maxHopDepth ?? 2, 1), 4)
    console.log(`[PoolDiscovery] Fetching multi-hop quotes (maxDepth=${maxDepth}) for ${tokenIn.symbol} -> ${tokenOut.symbol}`)

    const intermediateAddresses = this.config.intermediateTokenAddresses[chain.key] ?? []
    const validCandidates = intermediateAddresses.filter(
      (candidate) => !sameAddress(candidate, tokenIn.address) && !sameAddress(candidate, tokenOut.address)
    )

    if (validCandidates.length === 0) return []

    const intermediateTokens = await this.tokenService.getBatchTokenMetadata(
      chain,
      validCandidates as Address[]
    )

    const intermediateByAddress = new Map<string, TokenMetadata>()
    for (const t of intermediateTokens) {
      intermediateByAddress.set(t.address.toLowerCase(), t)
    }

    interface PartialRoute {
      path: TokenMetadata[]
      sources: PriceSource[]
      hopVersions: RouteHopVersion[]
      amountOut: bigint
      midPrices: bigint[]
      execPrices: bigint[]
      priceImpactBps: number
      liquidityScore: bigint
      gasPriceWei: bigint | null
    }

    const MAX_PARTIALS_PER_DEPTH = 5
    const results: PriceQuote[] = []

    // Depth-1: tokenIn → intermediate
    const legAQuotesArray = await Promise.all(
      intermediateTokens.map((intermediate) =>
        this.fetchDirectQuotes(chain, tokenIn, intermediate, amountIn, gasPriceWei, client, allowedVersions)
      )
    )

    let partials: PartialRoute[] = []
    for (let i = 0; i < intermediateTokens.length; i++) {
      const intermediate = intermediateTokens[i]!
      const legQuotes = legAQuotesArray[i]!
      for (const leg of legQuotes) {
        if (!leg || leg.amountOut === 0n) continue
        partials.push({
          path: [tokenIn, intermediate],
          sources: [...leg.sources],
          hopVersions: [...leg.hopVersions],
          amountOut: leg.amountOut,
          midPrices: [leg.midPriceQ18],
          execPrices: [leg.executionPriceQ18],
          priceImpactBps: leg.priceImpactBps,
          liquidityScore: leg.liquidityScore,
          gasPriceWei: leg.gasPriceWei,
        })
      }
    }

    // Try closing each partial → tokenOut at every depth
    for (let depth = 1; depth <= maxDepth; depth++) {
      if (partials.length === 0) break

      // Close attempt: partial.lastToken → tokenOut
      const closingQuotesArray = await Promise.all(
        partials.map((p) => {
          const lastToken = p.path[p.path.length - 1]!
          return this.fetchDirectQuotes(chain, lastToken, tokenOut, p.amountOut, gasPriceWei, client, allowedVersions)
        })
      )

      for (let i = 0; i < partials.length; i++) {
        const partial = partials[i]!
        const closingLegs = closingQuotesArray[i]!
        for (const leg of closingLegs) {
          if (!leg || leg.amountOut === 0n) continue

          const allMids = [...partial.midPrices, leg.midPriceQ18]
          const allExecs = [...partial.execPrices, leg.executionPriceQ18]
          const hopVersions: RouteHopVersion[] = [...partial.hopVersions, ...leg.hopVersions]
          const estimatedGasUnits = estimateGasForRoute(hopVersions)
          const gp = partial.gasPriceWei ?? leg.gasPriceWei ?? gasPriceWei
          const estimatedGasCostWei = gp ? estimatedGasUnits * gp : null

          const fullPath = [...partial.path, tokenOut]
          results.push({
            chain: chain.key,
            amountIn,
            amountOut: leg.amountOut,
            priceQ18: chainMultiplyQ18(allExecs),
            executionPriceQ18: chainMultiplyQ18(allExecs),
            midPriceQ18: chainMultiplyQ18(allMids),
            priceImpactBps: partial.priceImpactBps + leg.priceImpactBps,
            path: fullPath,
            routeAddresses: fullPath.map((t) => t.address),
            sources: [...partial.sources, ...leg.sources],
            liquidityScore: minBigInt(partial.liquidityScore, leg.liquidityScore),
            hopVersions,
            estimatedGasUnits,
            estimatedGasCostWei,
            gasPriceWei: gp ?? null,
          })
        }
      }

      // If we haven't reached max depth, expand partials by one more intermediate
      if (depth < maxDepth) {
        // Prune partials to top-K by amountOut
        partials.sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1))
        const pruned = partials.slice(0, MAX_PARTIALS_PER_DEPTH)

        const nextPartials: PartialRoute[] = []
        const expansionPromises = pruned.map((partial) => {
          const lastToken = partial.path[partial.path.length - 1]!
          const visitedAddresses = new Set(partial.path.map((t) => t.address.toLowerCase()))

          const expandTargets = intermediateTokens.filter(
            (t) => !visitedAddresses.has(t.address.toLowerCase()) && !sameAddress(t.address, tokenOut.address)
          )

          if (expandTargets.length === 0) return Promise.resolve([])

          return Promise.all(
            expandTargets.map((target) =>
              this.fetchDirectQuotes(chain, lastToken, target, partial.amountOut, gasPriceWei, client, allowedVersions)
                .then((quotes) => ({ target, quotes, partial }))
            )
          )
        })

        const expansionResults = await Promise.all(expansionPromises)
        for (const results of expansionResults) {
          if (!results || !Array.isArray(results)) continue
          for (const { target, quotes, partial } of results) {
            for (const leg of quotes) {
              if (!leg || leg.amountOut === 0n) continue
              nextPartials.push({
                path: [...partial.path, target],
                sources: [...partial.sources, ...leg.sources],
                hopVersions: [...partial.hopVersions, ...leg.hopVersions],
                amountOut: leg.amountOut,
                midPrices: [...partial.midPrices, leg.midPriceQ18],
                execPrices: [...partial.execPrices, leg.executionPriceQ18],
                priceImpactBps: partial.priceImpactBps + leg.priceImpactBps,
                liquidityScore: minBigInt(partial.liquidityScore, leg.liquidityScore),
                gasPriceWei: partial.gasPriceWei ?? leg.gasPriceWei,
              })
            }
          }
        }

        partials = nextPartials
      }
    }

    console.log(`[PoolDiscovery] Found ${results.length} multi-hop quotes for ${tokenIn.symbol} -> ${tokenOut.symbol}`)
    return results
  }
}
