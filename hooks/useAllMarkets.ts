"use client";

import { useMemo } from "react";
import { ATOKEN_ABI, DATA_PROVIDER_ABI, POOL_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { LUMINA, type CoreMarket } from "@/lib/deployments";
import { bigintAt, resultAt, useLuminaMulticall, type ContractCall } from "@/hooks/chain";

export interface ReserveConfig {
  ltv: number; // bps
  liquidationThreshold: number; // bps
  liquidationBonus: number; // bps, 10000 + bonus
  reserveFactor: number; // bps
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
}

/**
 * Every on-chain field is `undefined` when its read failed or has not loaded: callers show
 * "unavailable" and never compute limits or USD values from a missing read (Codex r1 #9).
 */
export interface MarketInfo extends CoreMarket {
  /** aToken totalSupply. */
  totalSupply: bigint | undefined;
  /** variable debt token totalSupply. */
  totalBorrow: bigint | undefined;
  /** currentLiquidityRate (ray). */
  supplyRate: bigint | undefined;
  /** currentVariableBorrowRate (ray). */
  borrowRate: bigint | undefined;
  accruedToTreasury: bigint | undefined;
  /** Strategy the reserve reports (compared with the manifest's, never called directly). */
  interestRateStrategy: `0x${string}` | undefined;
  /** Pool.getVirtualUnderlyingBalance: what can be borrowed / withdrawn right now. */
  availableLiquidity: bigint | undefined;
  /** Whole tokens; 0 = no cap. */
  borrowCap: bigint | undefined;
  supplyCap: bigint | undefined;
  /** DataProvider.getTotalDebt (base units). */
  totalDebt: bigint | undefined;
  config: ReserveConfig | undefined;
  paused: boolean | undefined;
  loaded: boolean;
}

const PER_MARKET = 8;

interface ReserveDataStruct {
  currentLiquidityRate: bigint;
  currentVariableBorrowRate: bigint;
  accruedToTreasury: bigint;
  interestRateStrategyAddress: `0x${string}`;
}

/**
 * Every core reserve in one multicall: rates, totals, liquidity, caps and risk config. Addresses
 * come from the manifest.
 */
export function useAllMarkets() {
  const pool = LUMINA.contracts.pool;
  const dataProvider = LUMINA.contracts.poolDataProvider;

  const calls: ContractCall[] = useMemo(
    () =>
      LUMINA.coreMarkets.flatMap((m) => [
        { address: pool, abi: POOL_ABI, functionName: "getReserveData", args: [m.asset] },
        { address: m.aToken, abi: ATOKEN_ABI, functionName: "totalSupply" },
        { address: m.variableDebtToken, abi: VARIABLE_DEBT_TOKEN_ABI, functionName: "totalSupply" },
        { address: pool, abi: POOL_ABI, functionName: "getVirtualUnderlyingBalance", args: [m.asset] },
        { address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getReserveCaps", args: [m.asset] },
        { address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getTotalDebt", args: [m.asset] },
        { address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getReserveConfigurationData", args: [m.asset] },
        { address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getPaused", args: [m.asset] },
      ]),
    [pool, dataProvider],
  );

  const query = useLuminaMulticall(calls, { policy: QUERY.market });
  const results = query.results;

  const markets: MarketInfo[] = useMemo(
    () =>
      LUMINA.coreMarkets.map((m, i) => {
        const base = i * PER_MARKET;
        const reserve = resultAt<ReserveDataStruct>(results, base);
        const caps = resultAt<readonly [bigint, bigint]>(results, base + 4);
        const paused = resultAt<unknown>(results, base + 7);
        const cfg = resultAt<readonly [bigint, bigint, bigint, bigint, bigint, boolean, boolean, boolean, boolean, boolean]>(
          results,
          base + 6,
        );
        return {
          ...m,
          totalSupply: bigintAt(results, base + 1),
          totalBorrow: bigintAt(results, base + 2),
          supplyRate: reserve?.currentLiquidityRate,
          borrowRate: reserve?.currentVariableBorrowRate,
          accruedToTreasury: reserve?.accruedToTreasury,
          interestRateStrategy: reserve?.interestRateStrategyAddress,
          availableLiquidity: bigintAt(results, base + 3),
          borrowCap: caps?.[0],
          supplyCap: caps?.[1],
          totalDebt: bigintAt(results, base + 5),
          config: cfg
            ? {
                ltv: Number(cfg[1]),
                liquidationThreshold: Number(cfg[2]),
                liquidationBonus: Number(cfg[3]),
                reserveFactor: Number(cfg[4]),
                usageAsCollateralEnabled: cfg[5],
                borrowingEnabled: cfg[6],
                isActive: cfg[8],
                isFrozen: cfg[9],
              }
            : undefined,
          paused: typeof paused === "boolean" ? paused : undefined,
          loaded: reserve !== undefined,
        };
      }),
    [results],
  );

  return {
    markets,
    getMarket: (asset: string) => markets.find((m) => m.asset.toLowerCase() === asset.toLowerCase()),
    isLoading: query.isLoading,
    error: query.error,
  };
}
