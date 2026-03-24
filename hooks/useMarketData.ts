import { useReadContract } from "wagmi";
import { POOL_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";

export interface ReserveData {
  configuration: bigint;              // packed configuration bitmap
  liquidityIndex: bigint;
  currentLiquidityRate: bigint;       // supply rate (RAY = 1e27)
  variableBorrowIndex: bigint;
  currentVariableBorrowRate: bigint;  // borrow rate (RAY = 1e27)
  currentStableBorrowRate: bigint;    // deprecated in V3
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
 * Fetches reserve data for a single asset from Pool.getReserveData(asset).
 * Returns the raw result along with a parsed ReserveData object.
 */
export function useMarketData(asset: `0x${string}`) {
  const result = useReadContract({
    address: ADDRESSES.pool as `0x${string}`,
    abi: POOL_ABI,
    functionName: "getReserveData",
    args: [asset],
    query: { refetchInterval: 15_000 },
  });

  const raw = result.data as ReserveDataResult | undefined;

  const reserveData: ReserveData | undefined = raw
    ? {
        configuration: raw.configuration.data,
        liquidityIndex: raw.liquidityIndex,
        currentLiquidityRate: raw.currentLiquidityRate,
        variableBorrowIndex: raw.variableBorrowIndex,
        currentVariableBorrowRate: raw.currentVariableBorrowRate,
        currentStableBorrowRate: raw.currentStableBorrowRate,
        lastUpdateTimestamp: raw.lastUpdateTimestamp,
        id: raw.id,
        aTokenAddress: raw.aTokenAddress,
        stableDebtTokenAddress: raw.stableDebtTokenAddress,
        variableDebtTokenAddress: raw.variableDebtTokenAddress,
        interestRateStrategyAddress: raw.interestRateStrategyAddress,
        accruedToTreasury: raw.accruedToTreasury,
        unbacked: raw.unbacked,
        isolationModeTotalDebt: raw.isolationModeTotalDebt,
      }
    : undefined;

  return {
    data: result.data,
    reserveData,
    isLoading: result.isLoading,
    error: result.error,
  };
}
