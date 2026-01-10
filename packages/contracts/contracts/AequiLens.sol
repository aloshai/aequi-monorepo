// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IERC20Metadata is IERC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
}

interface IPairV2 {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IPoolV3 {
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
    function liquidity() external view returns (uint128);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
}

/**
 * @title AequiLens
 * @notice Batch read contract for efficient pool and token data retrieval
 * @dev Reduces RPC overhead by batching multiple view calls into single transactions
 */
contract AequiLens {
    struct V2PoolData {
        address pairAddress;
        address token0;
        address token1;
        uint112 reserve0;
        uint112 reserve1;
        uint32 blockTimestampLast;
        bool exists;
    }

    struct V3PoolData {
        address poolAddress;
        address token0;
        address token1;
        uint24 fee;
        uint160 sqrtPriceX96;
        int24 tick;
        uint128 liquidity;
        bool exists;
    }

    struct TokenMetadata {
        address tokenAddress;
        string name;
        string symbol;
        uint8 decimals;
        uint256 totalSupply;
        bool exists;
    }

    /**
     * @notice Batch fetch V2 pool data (reserves, tokens)
     * @param pairs Array of V2 pair addresses
     * @return Array of V2PoolData structs
     */
    function batchGetV2PoolData(address[] calldata pairs) 
        external 
        view 
        returns (V2PoolData[] memory) 
    {
        V2PoolData[] memory results = new V2PoolData[](pairs.length);
        
        for (uint256 i = 0; i < pairs.length; i++) {
            address pair = pairs[i];
            
            if (pair.code.length == 0) {
                results[i].exists = false;
                continue;
            }

            try IPairV2(pair).getReserves() returns (
                uint112 reserve0,
                uint112 reserve1,
                uint32 blockTimestampLast
            ) {
                try IPairV2(pair).token0() returns (address token0) {
                    try IPairV2(pair).token1() returns (address token1) {
                        results[i] = V2PoolData({
                            pairAddress: pair,
                            token0: token0,
                            token1: token1,
                            reserve0: reserve0,
                            reserve1: reserve1,
                            blockTimestampLast: blockTimestampLast,
                            exists: true
                        });
                    } catch {
                        results[i].exists = false;
                    }
                } catch {
                    results[i].exists = false;
                }
            } catch {
                results[i].exists = false;
            }
        }
        
        return results;
    }

    /**
     * @notice Batch fetch V3 pool data (liquidity, tick, price)
     * @param pools Array of V3 pool addresses
     * @return Array of V3PoolData structs
     */
    function batchGetV3PoolData(address[] calldata pools)
        external
        view
        returns (V3PoolData[] memory)
    {
        V3PoolData[] memory results = new V3PoolData[](pools.length);
        
        for (uint256 i = 0; i < pools.length; i++) {
            address pool = pools[i];
            results[i].poolAddress = pool;
            
            if (pool.code.length == 0) {
                results[i].exists = false;
                continue;
            }

            // Try to get all data in one big try-catch to avoid nested complexity
            try this.getV3PoolDataSingle(pool) returns (V3PoolData memory data) {
                results[i] = data;
            } catch {
                results[i].exists = false;
            }
        }
        
        return results;
    }

    function getV3PoolDataSingle(address pool) external view returns (V3PoolData memory) {
        V3PoolData memory data;
        data.poolAddress = pool;
        
        (
            uint160 sqrtPriceX96,
            int24 tick,
            ,,,, // observationIndex, observationCardinality, observationCardinalityNext, feeProtocol
        ) = IPoolV3(pool).slot0();
        
        data.sqrtPriceX96 = sqrtPriceX96;
        data.tick = tick;
        data.liquidity = IPoolV3(pool).liquidity();
        data.token0 = IPoolV3(pool).token0();
        data.token1 = IPoolV3(pool).token1();
        data.fee = IPoolV3(pool).fee();
        data.exists = true;
        
        return data;
    }

    /**
     * @notice Batch fetch token metadata (name, symbol, decimals, supply)
     * @param tokens Array of token addresses
     * @return Array of TokenMetadata structs
     */
    function batchGetTokenMetadata(address[] calldata tokens)
        external
        view
        returns (TokenMetadata[] memory)
    {
        TokenMetadata[] memory results = new TokenMetadata[](tokens.length);
        
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            
            if (token.code.length == 0) {
                results[i].exists = false;
                continue;
            }

            try IERC20Metadata(token).name() returns (string memory name) {
                try IERC20Metadata(token).symbol() returns (string memory symbol) {
                    try IERC20Metadata(token).decimals() returns (uint8 decimals) {
                        try IERC20Metadata(token).totalSupply() returns (uint256 totalSupply) {
                            results[i] = TokenMetadata({
                                tokenAddress: token,
                                name: name,
                                symbol: symbol,
                                decimals: decimals,
                                totalSupply: totalSupply,
                                exists: true
                            });
                        } catch {
                            results[i].exists = false;
                        }
                    } catch {
                        results[i].exists = false;
                    }
                } catch {
                    results[i].exists = false;
                }
            } catch {
                results[i].exists = false;
            }
        }
        
        return results;
    }

    /**
     * @notice Batch check token balances for a single account
     * @param tokens Array of token addresses
     * @param account The account to check balances for
     * @return Array of balances
     */
    function batchCheckTokenBalances(
        address[] calldata tokens,
        address account
    ) external view returns (uint256[] memory) {
        uint256[] memory balances = new uint256[](tokens.length);
        
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i].code.length == 0) {
                balances[i] = 0;
                continue;
            }

            try IERC20(tokens[i]).balanceOf(account) returns (uint256 balance) {
                balances[i] = balance;
            } catch {
                balances[i] = 0;
            }
        }
        
        return balances;
    }

    /**
     * @notice Batch check token allowances
     * @param tokens Array of token addresses
     * @param owner Token owner
     * @param spender Approved spender
     * @return Array of allowances
     */
    function batchCheckAllowances(
        address[] calldata tokens,
        address owner,
        address spender
    ) external view returns (uint256[] memory) {
        uint256[] memory allowances = new uint256[](tokens.length);
        
        for (uint256 i = 0; i < tokens.length; i++) {
            if (tokens[i].code.length == 0) {
                allowances[i] = 0;
                continue;
            }

            try IERC20(tokens[i]).allowance(owner, spender) returns (uint256 allowance) {
                allowances[i] = allowance;
            } catch {
                allowances[i] = 0;
            }
        }
        
        return allowances;
    }
}
