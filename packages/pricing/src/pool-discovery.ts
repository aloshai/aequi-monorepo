import type { Address, PublicClient } from 'viem'
import type { ChainConfig, DexConfig, PriceQuote, PriceSource, RouteHopVersion, TokenMetadata } from '@aequi/core'
import { AEQUI_LENS_ABI } from '@aequi/core'
import { V2_FACTORY_ABI, V2_PAIR_ABI, V3_FACTORY_ABI, V3_POOL_ABI, V3_QUOTER_ABI, ZERO_ADDRESS, normalizeAddress, AEQUI_LENS_ADDRESSES, sameAddress } from './contracts'
import { minBigInt, multiplyQ18, chainMultiplyQ18 } from './math'
import { estimateGasForRoute, getV2AmountOut, computeMidPriceQ18FromReserves, computeExecutionPriceQ18, computePriceImpactBps, estimateV3AmountOut, computeV3MidPriceQ18FromSqrtPrice } from './quote-math'
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

interface PoolNode {
  poolAddress: Address
  dex: DexConfig
  version: 'v2' | 'v3'
  fee: number
  token0: Address
  token1: Address
  reserve0: bigint
  reserve1: bigint
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
}

type PoolGraph = Map<string, PoolNode[]>

const pairKey = (a: Address, b: Address): string => {
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  return la < lb ? `${la}-${lb}` : `${lb}-${la}`
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

  private async buildPoolGraph(
    chain: ChainConfig,
    allTokens: TokenMetadata[],
    client: PublicClient,
    allowedVersions: RouteHopVersion[],
  ): Promise<PoolGraph> {
    const graph: PoolGraph = new Map()

    const pairs: [TokenMetadata, TokenMetadata][] = []
    for (let i = 0; i < allTokens.length; i++) {
      for (let j = i + 1; j < allTokens.length; j++) {
        pairs.push([allTokens[i]!, allTokens[j]!])
      }
    }

    if (pairs.length === 0) return graph

    const factoryCalls: any[] = []
    const callMeta: { pairIdx: number; dex: DexConfig; type: 'v2' | 'v3'; fee: number }[] = []

    for (let pairIdx = 0; pairIdx < pairs.length; pairIdx++) {
      const [tokenA, tokenB] = pairs[pairIdx]!
      for (const dex of chain.dexes) {
        if (!allowedVersions.includes(dex.version)) continue
        if (dex.version === 'v2') {
          factoryCalls.push({
            address: dex.factoryAddress,
            abi: V2_FACTORY_ABI,
            functionName: 'getPair',
            args: [tokenA.address, tokenB.address],
          })
          callMeta.push({ pairIdx, dex, type: 'v2', fee: 0 })
        } else {
          for (const fee of (dex.feeTiers ?? [])) {
            factoryCalls.push({
              address: dex.factoryAddress,
              abi: V3_FACTORY_ABI,
              functionName: 'getPool',
              args: [tokenA.address, tokenB.address, fee],
            })
            callMeta.push({ pairIdx, dex, type: 'v3', fee })
          }
        }
      }
    }

    if (factoryCalls.length === 0) return graph

    const factoryResults = await client.multicall({ allowFailure: true, contracts: factoryCalls })

    const v2PoolAddresses: Address[] = []
    const v3PoolAddresses: Address[] = []
    interface DiscoveredPool { poolAddress: Address; pairIdx: number; dex: DexConfig; type: 'v2' | 'v3'; fee: number }
    const discoveredPools: DiscoveredPool[] = []

    for (let i = 0; i < callMeta.length; i++) {
      const result = factoryResults[i]
      if (!result || result.status !== 'success' || !result.result || result.result === ZERO_ADDRESS) continue
      const meta = callMeta[i]!
      const poolAddress = result.result as Address
      discoveredPools.push({ poolAddress, pairIdx: meta.pairIdx, dex: meta.dex, type: meta.type, fee: meta.fee })
      if (meta.type === 'v2') {
        v2PoolAddresses.push(poolAddress)
      } else {
        v3PoolAddresses.push(poolAddress)
      }
    }

    if (discoveredPools.length === 0) return graph

    const v2DataMap = new Map<string, { reserve0: bigint; reserve1: bigint; token0: Address }>()
    const v3DataMap = new Map<string, { sqrtPriceX96: bigint; tick: number; liquidity: bigint; token0: Address; token1: Address }>()

    const lensAddress = AEQUI_LENS_ADDRESSES[chain.id]

    if (lensAddress) {
      const lensPromises: Promise<void>[] = []

      if (v2PoolAddresses.length > 0) {
        lensPromises.push(
          client.readContract({
            address: lensAddress,
            abi: AEQUI_LENS_ABI,
            functionName: 'batchGetV2PoolData',
            args: [v2PoolAddresses],
          }).then((batchResult) => {
            ;(batchResult as any[]).forEach((data: any, idx: number) => {
              if (!data.exists) return
              v2DataMap.set(v2PoolAddresses[idx]!.toLowerCase(), {
                reserve0: data.reserve0,
                reserve1: data.reserve1,
                token0: data.token0,
              })
            })
          }).catch(() => {})
        )
      }

      if (v3PoolAddresses.length > 0) {
        lensPromises.push(
          client.readContract({
            address: lensAddress,
            abi: AEQUI_LENS_ABI,
            functionName: 'batchGetV3PoolData',
            args: [v3PoolAddresses],
          }).then((batchResult) => {
            ;(batchResult as any[]).forEach((data: any, idx: number) => {
              if (!data.exists) return
              v3DataMap.set(v3PoolAddresses[idx]!.toLowerCase(), {
                sqrtPriceX96: data.sqrtPriceX96,
                tick: Number(data.tick),
                liquidity: data.liquidity,
                token0: data.token0,
                token1: data.token1,
              })
            })
          }).catch(() => {})
        )
      }

      await Promise.all(lensPromises)
    }

    // Fallback multicall for pools not covered by lens
    const missingV2 = v2PoolAddresses.filter((a) => !v2DataMap.has(a.toLowerCase()))
    const missingV3 = v3PoolAddresses.filter((a) => !v3DataMap.has(a.toLowerCase()))

    if (missingV2.length > 0) {
      const calls: any[] = []
      missingV2.forEach((addr) => {
        calls.push(
          { address: addr, abi: V2_PAIR_ABI, functionName: 'getReserves' },
          { address: addr, abi: V2_PAIR_ABI, functionName: 'token0' },
        )
      })
      try {
        const results = await client.multicall({ allowFailure: true, contracts: calls })
        missingV2.forEach((addr, i) => {
          const reservesRes = results[i * 2]
          const token0Res = results[i * 2 + 1]
          if (reservesRes?.status === 'success' && token0Res?.status === 'success') {
            const [r0, r1] = reservesRes.result as readonly [bigint, bigint, number]
            v2DataMap.set(addr.toLowerCase(), {
              reserve0: r0,
              reserve1: r1,
              token0: normalizeAddress(token0Res.result as Address),
            })
          }
        })
      } catch {}
    }

    if (missingV3.length > 0) {
      const calls: any[] = []
      missingV3.forEach((addr) => {
        calls.push(
          { address: addr, abi: V3_POOL_ABI, functionName: 'slot0' },
          { address: addr, abi: V3_POOL_ABI, functionName: 'liquidity' },
          { address: addr, abi: V3_POOL_ABI, functionName: 'token0' },
          { address: addr, abi: V3_POOL_ABI, functionName: 'token1' },
        )
      })
      try {
        const results = await client.multicall({ allowFailure: true, contracts: calls })
        missingV3.forEach((addr, i) => {
          const base = i * 4
          const slotRes = results[base]
          const liqRes = results[base + 1]
          const t0Res = results[base + 2]
          const t1Res = results[base + 3]
          if (slotRes?.status === 'success' && liqRes?.status === 'success' && t0Res?.status === 'success' && t1Res?.status === 'success') {
            const slotData = slotRes.result as readonly [bigint, number, number, number, number, number, boolean]
            v3DataMap.set(addr.toLowerCase(), {
              sqrtPriceX96: slotData[0],
              tick: Number(slotData[1]),
              liquidity: liqRes.result as bigint,
              token0: normalizeAddress(t0Res.result as Address),
              token1: normalizeAddress(t1Res.result as Address),
            })
          }
        })
      } catch {}
    }

    for (const dp of discoveredPools) {
      const [tokenA, tokenB] = pairs[dp.pairIdx]!
      const key = pairKey(tokenA.address, tokenB.address)
      const addrKey = dp.poolAddress.toLowerCase()

      let node: PoolNode | null = null

      if (dp.type === 'v2') {
        const data = v2DataMap.get(addrKey)
        if (!data) continue
        if (data.reserve0 < this.config.minV2ReserveThreshold && data.reserve1 < this.config.minV2ReserveThreshold) continue
        node = {
          poolAddress: dp.poolAddress,
          dex: dp.dex,
          version: 'v2',
          fee: 0,
          token0: data.token0,
          token1: sameAddress(data.token0, tokenA.address) ? tokenB.address : tokenA.address,
          reserve0: data.reserve0,
          reserve1: data.reserve1,
          sqrtPriceX96: 0n,
          tick: 0,
          liquidity: 0n,
        }
      } else {
        const data = v3DataMap.get(addrKey)
        if (!data) continue
        if (data.liquidity < this.config.minV3LiquidityThreshold) continue
        node = {
          poolAddress: dp.poolAddress,
          dex: dp.dex,
          version: 'v3',
          fee: dp.fee,
          token0: data.token0,
          token1: data.token1,
          reserve0: 0n,
          reserve1: 0n,
          sqrtPriceX96: data.sqrtPriceX96,
          tick: data.tick,
          liquidity: data.liquidity,
        }
      }

      if (!graph.has(key)) graph.set(key, [])
      graph.get(key)!.push(node)
    }

    console.log(`[PoolDiscovery] Built pool graph: ${pairs.length} pairs, ${discoveredPools.length} pools discovered, ${[...graph.values()].reduce((s, v) => s + v.length, 0)} nodes`)
    return graph
  }

  private computeLocalQuotes(
    chain: ChainConfig,
    graph: PoolGraph,
    tokenIn: TokenMetadata,
    tokenOut: TokenMetadata,
    amountIn: bigint,
    gasPriceWei: bigint | null,
  ): PriceQuote[] {
    const key = pairKey(tokenIn.address, tokenOut.address)
    const pools = graph.get(key)
    if (!pools || pools.length === 0) return []

    const quotes: PriceQuote[] = []

    for (const node of pools) {
      try {
        if (node.version === 'v2') {
          const isToken0In = sameAddress(node.token0, tokenIn.address)
          const reserveIn = isToken0In ? node.reserve0 : node.reserve1
          const reserveOut = isToken0In ? node.reserve1 : node.reserve0

          if (reserveIn < this.config.minV2ReserveThreshold || reserveOut < this.config.minV2ReserveThreshold) continue

          const amountOut = getV2AmountOut(amountIn, reserveIn, reserveOut, node.dex.protocol)
          if (amountOut <= 0n) continue

          const midPriceQ18 = computeMidPriceQ18FromReserves(node.dex.protocol, reserveIn, reserveOut, tokenIn.decimals, tokenOut.decimals)
          const executionPriceQ18 = computeExecutionPriceQ18(amountIn, amountOut, tokenIn.decimals, tokenOut.decimals)
          const priceImpactBps = computePriceImpactBps(midPriceQ18, amountIn, amountOut, tokenIn.decimals, tokenOut.decimals)

          const hopVersions: RouteHopVersion[] = ['v2']
          const estimatedGasUnits = estimateGasForRoute(hopVersions)
          const estimatedGasCostWei = gasPriceWei ? estimatedGasUnits * gasPriceWei : null

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
            sources: [{
              dexId: node.dex.id,
              poolAddress: node.poolAddress,
              amountIn,
              amountOut,
              reserves: {
                reserve0: node.reserve0,
                reserve1: node.reserve1,
                token0: node.token0,
                token1: node.token1,
              },
            }],
            liquidityScore: reserveIn + reserveOut,
            hopVersions,
            estimatedGasUnits,
            estimatedGasCostWei,
            gasPriceWei,
          })
        } else {
          const zeroForOne = sameAddress(node.token0, tokenIn.address)
          const amountOut = estimateV3AmountOut(node.sqrtPriceX96, node.liquidity, amountIn, node.fee, zeroForOne)
          if (amountOut <= 0n) continue

          const midPriceQ18 = computeV3MidPriceQ18FromSqrtPrice(node.sqrtPriceX96, zeroForOne, tokenIn.decimals, tokenOut.decimals)
          const executionPriceQ18 = computeExecutionPriceQ18(amountIn, amountOut, tokenIn.decimals, tokenOut.decimals)
          const priceImpactBps = computePriceImpactBps(midPriceQ18, amountIn, amountOut, tokenIn.decimals, tokenOut.decimals)

          const hopVersions: RouteHopVersion[] = ['v3']
          const estimatedGasUnits = estimateGasForRoute(hopVersions)
          const estimatedGasCostWei = gasPriceWei ? estimatedGasUnits * gasPriceWei : null

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
            sources: [{
              dexId: node.dex.id,
              poolAddress: node.poolAddress,
              feeTier: node.fee,
              amountIn,
              amountOut,
              reserves: {
                liquidity: node.liquidity,
                sqrtPriceX96: node.sqrtPriceX96,
                tick: node.tick,
                token0: node.token0,
                token1: node.token1,
              },
            }],
            liquidityScore: node.liquidity,
            hopVersions,
            estimatedGasUnits,
            estimatedGasCostWei,
            gasPriceWei,
          })
        }
      } catch {
        continue
      }
    }

    return quotes
  }

  async batchValidateRoutes(
    candidates: PriceQuote[],
    chain: ChainConfig,
    client: PublicClient,
    gasPriceWei: bigint | null,
  ): Promise<PriceQuote[]> {
    if (candidates.length === 0) return []

    const hasAnyV3 = candidates.some((q) => q.hopVersions.some((v) => v === 'v3'))
    if (!hasAnyV3) return candidates

    const maxHops = Math.max(...candidates.map((q) => q.sources.length))
    const rollingAmounts = candidates.map((q) => q.amountIn)
    const validatedSources: (PriceSource | null)[][] = candidates.map(() => [])
    const failed = new Set<number>()

    for (let hopPos = 0; hopPos < maxHops; hopPos++) {
      const v3Batch: { routeIdx: number; call: any }[] = []

      for (let routeIdx = 0; routeIdx < candidates.length; routeIdx++) {
        if (failed.has(routeIdx)) continue
        const quote = candidates[routeIdx]!
        if (hopPos >= quote.sources.length) continue

        const source = quote.sources[hopPos]!
        const hopVersion = quote.hopVersions[hopPos]!
        const hopAmountIn = rollingAmounts[routeIdx]!
        const hopTokenIn = quote.path[hopPos]!

        if (hopVersion === 'v2') {
          if (!source.reserves?.token0 || source.reserves.reserve0 === undefined || source.reserves.reserve1 === undefined) {
            failed.add(routeIdx)
            continue
          }
          const isToken0In = hopTokenIn.address.toLowerCase() === source.reserves.token0.toLowerCase()
          const reserveIn = isToken0In ? source.reserves.reserve0 : source.reserves.reserve1
          const reserveOut = isToken0In ? source.reserves.reserve1 : source.reserves.reserve0
          const dex = chain.dexes.find((d) => d.id === source.dexId)
          const amountOut = getV2AmountOut(hopAmountIn, reserveIn, reserveOut, dex?.protocol)
          if (amountOut <= 0n) { failed.add(routeIdx); continue }

          validatedSources[routeIdx]!.push({ ...source, amountIn: hopAmountIn, amountOut })
          rollingAmounts[routeIdx] = amountOut
        } else {
          const dex = chain.dexes.find((d) => d.id === source.dexId)
          if (!dex?.quoterAddress) { failed.add(routeIdx); continue }

          const hopTokenOut = quote.path[hopPos + 1]!
          v3Batch.push({
            routeIdx,
            call: {
              address: dex.quoterAddress,
              abi: V3_QUOTER_ABI,
              functionName: 'quoteExactInputSingle',
              args: [{
                tokenIn: hopTokenIn.address,
                tokenOut: hopTokenOut.address,
                amountIn: hopAmountIn,
                fee: source.feeTier ?? 0,
                sqrtPriceLimitX96: 0n,
              }],
            },
          })
        }
      }

      if (v3Batch.length > 0) {
        try {
          const results = await client.multicall({
            allowFailure: true,
            contracts: v3Batch.map((b) => b.call),
          })

          for (let i = 0; i < v3Batch.length; i++) {
            const { routeIdx } = v3Batch[i]!
            const result = results[i]
            const source = candidates[routeIdx]!.sources[hopPos]!

            if (!result || result.status !== 'success') {
              failed.add(routeIdx)
              continue
            }

            const [amountOut] = result.result as readonly [bigint, bigint, number, bigint]
            if (amountOut <= 0n) { failed.add(routeIdx); continue }

            validatedSources[routeIdx]!.push({ ...source, amountIn: rollingAmounts[routeIdx]!, amountOut })
            rollingAmounts[routeIdx] = amountOut
          }
        } catch {
          v3Batch.forEach(({ routeIdx }) => failed.add(routeIdx))
        }
      }
    }

    const validated: PriceQuote[] = []
    for (let routeIdx = 0; routeIdx < candidates.length; routeIdx++) {
      if (failed.has(routeIdx)) continue
      const original = candidates[routeIdx]!
      const sources = validatedSources[routeIdx]!.filter((s): s is PriceSource => s !== null)
      if (sources.length !== original.sources.length) continue

      const finalAmountOut = rollingAmounts[routeIdx]!
      if (finalAmountOut <= 0n) continue

      const firstToken = original.path[0]!
      const lastToken = original.path[original.path.length - 1]!
      const executionPriceQ18 = computeExecutionPriceQ18(original.amountIn, finalAmountOut, firstToken.decimals, lastToken.decimals)
      const priceImpactBps = computePriceImpactBps(original.midPriceQ18, original.amountIn, finalAmountOut, firstToken.decimals, lastToken.decimals)
      const estimatedGasUnits = estimateGasForRoute(original.hopVersions)
      const gp = gasPriceWei ?? original.gasPriceWei
      const estimatedGasCostWei = gp ? estimatedGasUnits * gp : null

      validated.push({
        ...original,
        amountOut: finalAmountOut,
        priceQ18: executionPriceQ18,
        executionPriceQ18,
        priceImpactBps,
        sources,
        estimatedGasUnits,
        estimatedGasCostWei,
      })
    }

    return validated
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

    // Phase 1: Build pool graph for all relevant tokens — 3 RPC calls max
    const allTokens = [tokenIn, tokenOut, ...intermediateTokens]
    const graph = await this.buildPoolGraph(chain, allTokens, client, allowedVersions)

    // Phase 2: Iterative deepening on local graph — 0 RPC calls
    const VALIDATION_TOP_K = 16
    const MAX_PARTIALS_PER_DEPTH = 12

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

    const results: PriceQuote[] = []

    let partials: PartialRoute[] = []
    for (const intermediate of intermediateTokens) {
      const legQuotes = this.computeLocalQuotes(chain, graph, tokenIn, intermediate, amountIn, gasPriceWei)
      for (const leg of legQuotes) {
        if (leg.amountOut === 0n) continue
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

    for (let depth = 1; depth <= maxDepth; depth++) {
      if (partials.length === 0) break

      for (const partial of partials) {
        const lastToken = partial.path[partial.path.length - 1]!
        const closingLegs = this.computeLocalQuotes(chain, graph, lastToken, tokenOut, partial.amountOut, gasPriceWei)
        for (const leg of closingLegs) {
          if (leg.amountOut === 0n) continue

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

      if (depth < maxDepth) {
        partials.sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1))
        const pruned = partials.slice(0, MAX_PARTIALS_PER_DEPTH)

        const nextPartials: PartialRoute[] = []
        for (const partial of pruned) {
          const lastToken = partial.path[partial.path.length - 1]!
          const visitedAddresses = new Set(partial.path.map((t) => t.address.toLowerCase()))

          const expandTargets = intermediateTokens.filter(
            (t) => !visitedAddresses.has(t.address.toLowerCase()) && !sameAddress(t.address, tokenOut.address)
          )

          for (const target of expandTargets) {
            const legQuotes = this.computeLocalQuotes(chain, graph, lastToken, target, partial.amountOut, gasPriceWei)
            for (const leg of legQuotes) {
              if (leg.amountOut === 0n) continue
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

    // Phase 3: Validate top-K routes with V3 hops via batched quoter — 1 RPC per hop depth
    if (results.length === 0) {
      console.log(`[PoolDiscovery] No multi-hop routes found for ${tokenIn.symbol} -> ${tokenOut.symbol}`)
      return []
    }

    const hasV3Hop = (q: PriceQuote) => q.hopVersions.some((v) => v === 'v3')
    const v2OnlyRoutes = results.filter((r) => !hasV3Hop(r))
    const v3Routes = results.filter(hasV3Hop)

    let validatedV3: PriceQuote[] = []
    if (v3Routes.length > 0) {
      v3Routes.sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1))
      const topV3 = v3Routes.slice(0, VALIDATION_TOP_K)
      validatedV3 = await this.batchValidateRoutes(topV3, chain, client, gasPriceWei)
    }

    const allRoutes = [...v2OnlyRoutes, ...validatedV3]
    console.log(`[PoolDiscovery] Found ${allRoutes.length} multi-hop quotes for ${tokenIn.symbol} -> ${tokenOut.symbol} (${v2OnlyRoutes.length} V2-only, ${validatedV3.length} V3-validated)`)
    return allRoutes
  }
}
