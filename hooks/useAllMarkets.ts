import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { POOL_ABI, ATOKEN_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS, type MarketConfig } from "@/lib/constants";

export interface MarketInfo extends MarketConfig {
  totalSupply: bigint;      // aToken totalSupply
  totalBorrow: bigint;      // variableDebtToken totalSupply
  supplyRate: bigint;       // currentLiquidityRate (RAY = 1e27)
  borrowRate: bigint;       // currentVariableBorrowRate (RAY = 1e27)
  aTokenAddress: `0x${string}`;
  variableDebtTokenAddress: `0x${string}`;
}

/** Shape returned by Pool.getReserveData (matches the ABI tuple struct) */
interface ReserveDataResult {
  configuration: { data: bigint };
  liquidityIndex: bigint;
  currentLiquidityRate: bigint;
  variableBorrowIndex: bigint;
  currentVariableBorrowRate: bigint;
  currentStableBorrowRate: bigint;
  lastUpdateTimestamp: bigint;
  id: number;
  aTokenAddress: `0x${string}`;
  stableDebtTokenAddress: `0x${string}`;
  variableDebtTokenAddress: `0x${string}`;
  interestRateStrategyAddress: `0x${string}`;
  accruedToTreasury: bigint;
  unbacked: bigint;
  isolationModeTotalDebt: bigint;
}

/**
 * Fetches all market data from the Aave V3 Pool contract.
 *
 * For each market in MARKETS:
 *   1. Pool.getReserveData(asset) -> reserve config including rates, aToken & debtToken addresses
 *   2. aToken.totalSupply() -> total supplied
 *   3. variableDebtToken.totalSupply() -> total borrowed
 *
 * This is done in two passes:
 *   Pass 1: getReserveData for all markets (to learn aToken/debtToken addresses + rates)
 *   Pass 2: totalSupply calls on aToken + debtToken
 */
export function useAllMarkets() {
  // --- Pass 1: fetch getReserveData for each market ---
  const reserveContracts = MARKETS.map((m) => ({
    address: ADDRESSES.pool as `0x${string}`,
    abi: POOL_ABI,
    functionName: "getReserveData" as const,
    args: [m.asset] as const,
  }));

  const reserveResult = useReadContracts({
    contracts: reserveContracts,
    query: { ...QUERY.market },
  });

  // Extract data from reserve results — defensive parsing
  // F-013: Handle both array (positional) and object (named) return formats
  const reserveParsed = useMemo(() => MARKETS.map((_m, i) => {
    const defaults = { supplyRate: 0n, borrowRate: 0n, aTokenAddress: _m.aToken, variableDebtTokenAddress: _m.variableDebtToken };
    try {
      const raw = reserveResult.data?.[i]?.result;
      if (!raw) return defaults;

      // Handle array (positional) format
      if (Array.isArray(raw)) {
        // ReserveData struct fields by position:
        // [0] configuration, [1] liquidityIndex, [2] currentLiquidityRate,
        // [3] variableBorrowIndex, [4] currentVariableBorrowRate, ...
        // [8] aTokenAddress, [10] variableDebtTokenAddress
        return {
          supplyRate: (raw[2] as bigint) ?? 0n,
          borrowRate: (raw[4] as bigint) ?? 0n,
          aTokenAddress: (raw[8] as `0x${string}`) ?? _m.aToken,
          variableDebtTokenAddress: (raw[10] as `0x${string}`) ?? _m.variableDebtToken,
        };
      }

      const d = raw as Record<string, unknown>;
      // viem returns struct as object with named fields
      if (d.aTokenAddress) {
        return {
          supplyRate: (d.currentLiquidityRate as bigint) ?? 0n,
          borrowRate: (d.currentVariableBorrowRate as bigint) ?? 0n,
          aTokenAddress: (d.aTokenAddress as `0x${string}`) ?? _m.aToken,
          variableDebtTokenAddress: (d.variableDebtTokenAddress as `0x${string}`) ?? _m.variableDebtToken,
        };
      }
      return defaults;
    } catch {
      return defaults;
    }
  }), [reserveResult.data]);

  // --- Pass 2: fetch totalSupply for aTokens and debtTokens ---
  const hasReserveData = reserveResult.data && reserveResult.data.length > 0;

  const supplyContracts = useMemo(() => hasReserveData
    ? MARKETS.flatMap((_m, i) => [
        {
          address: reserveParsed[i].aTokenAddress,
          abi: ATOKEN_ABI,
          functionName: "totalSupply" as const,
          args: [] as const,
        },
        {
          address: reserveParsed[i].variableDebtTokenAddress,
          abi: VARIABLE_DEBT_TOKEN_ABI,
          functionName: "totalSupply" as const,
          args: [] as const,
        },
      ])
    : [], [hasReserveData, reserveParsed]);

  const supplyResult = useReadContracts({
    contracts: supplyContracts,
    query: {
      enabled: !!hasReserveData,
      ...QUERY.market,
    },
  });

  // --- Combine results ---
  const markets: MarketInfo[] = MARKETS.map((m, i) => {
    const totalSupply = (supplyResult.data?.[i * 2]?.result as bigint) ?? 0n;
    const totalBorrow = (supplyResult.data?.[i * 2 + 1]?.result as bigint) ?? 0n;

    return {
      ...m,
      totalSupply,
      totalBorrow,
      supplyRate: reserveParsed[i].supplyRate,
      borrowRate: reserveParsed[i].borrowRate,
      aTokenAddress: reserveParsed[i].aTokenAddress,
      variableDebtTokenAddress: reserveParsed[i].variableDebtTokenAddress,
    };
  });

  return {
    markets,
    isLoading: reserveResult.isLoading || (!!hasReserveData && supplyResult.isLoading),
    error: reserveResult.error || supplyResult.error,
  };
}
