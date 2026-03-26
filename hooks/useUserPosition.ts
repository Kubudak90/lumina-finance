import { useReadContracts, useReadContract, useAccount } from "wagmi";
import { POOL_ABI, ATOKEN_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";
import { useUserCollateralStatus } from "./useUserCollateralStatus";
import { safeBigInt } from "@/lib/format";

export interface UserMarketPosition {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  supplied: bigint;    // aToken balanceOf(user)
  borrowed: bigint;    // variableDebtToken balanceOf(user)
  /** In Aave V3 supplied assets are collateral, so collateral = supplied */
  collateral: bigint;
  collateralEnabled: boolean; // derived from supplied > 0 (Aave V3: supply = collateral)
}

export interface UserAccountData {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
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
 * Fetches the user's positions across all markets.
 *
 * Uses:
 *   - Pool.getUserAccountData(user) -> aggregate account health data
 *   - Pool.getReserveData(asset) -> to discover aToken & debtToken addresses
 *   - aToken.balanceOf(user) -> user's supply balance per market
 *   - variableDebtToken.balanceOf(user) -> user's borrow balance per market
 */
export function useUserPosition() {
  const { address } = useAccount();
  const { isCollateralEnabled } = useUserCollateralStatus();
  const enabled = !!address;

  // --- Step 1: Get reserve data to find aToken/debtToken addresses ---
  const reserveContracts = MARKETS.map((m) => ({
    address: ADDRESSES.pool as `0x${string}`,
    abi: POOL_ABI,
    functionName: "getReserveData" as const,
    args: [m.asset] as const,
  }));

  const reserveResult = useReadContracts({
    contracts: reserveContracts,
    query: { refetchInterval: 30_000 },
  });

  const reserveParsed = MARKETS.map((_m, i) => {
    const defaults = { aTokenAddress: _m.aToken, variableDebtTokenAddress: _m.variableDebtToken };
    try {
      const raw = reserveResult.data?.[i]?.result;
      if (!raw) return defaults;
      if (Array.isArray(raw)) {
        return {
          aTokenAddress: (raw[8] as `0x${string}`) ?? _m.aToken,
          variableDebtTokenAddress: (raw[10] as `0x${string}`) ?? _m.variableDebtToken,
        };
      }
      const d = raw as Record<string, unknown>;
      if (d.aTokenAddress) {
        return {
          aTokenAddress: (d.aTokenAddress as `0x${string}`) ?? _m.aToken,
          variableDebtTokenAddress: (d.variableDebtTokenAddress as `0x${string}`) ?? _m.variableDebtToken,
        };
      }
      return defaults;
    } catch {
      return defaults;
    }
  });

  const hasReserveData = reserveResult.data && reserveResult.data.length > 0;

  // --- Step 2: Get user account data (aggregate) ---
  const accountResult = useReadContract({
    address: ADDRESSES.pool as `0x${string}`,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 10_000 },
  });

  // viem may return as array or named object depending on ABI shape
  let accountData: UserAccountData | undefined;
  if (accountResult.data) {
    const d = accountResult.data as unknown;
    if (Array.isArray(d)) {
      accountData = {
        totalCollateralBase: safeBigInt(d[0]),
        totalDebtBase: safeBigInt(d[1]),
        availableBorrowsBase: safeBigInt(d[2]),
        currentLiquidationThreshold: safeBigInt(d[3]),
        ltv: safeBigInt(d[4]),
        healthFactor: safeBigInt(d[5]),
      };
    } else if (typeof d === "object" && d !== null) {
      const obj = d as Record<string, unknown>;
      accountData = {
        totalCollateralBase: safeBigInt(obj.totalCollateralBase),
        totalDebtBase: safeBigInt(obj.totalDebtBase),
        availableBorrowsBase: safeBigInt(obj.availableBorrowsBase),
        currentLiquidationThreshold: safeBigInt(obj.currentLiquidationThreshold),
        ltv: safeBigInt(obj.ltv),
        healthFactor: safeBigInt(obj.healthFactor),
      };
    }
  }

  // --- Step 3: Per-market balances (aToken + debtToken) ---
  const balanceContracts =
    enabled && hasReserveData
      ? MARKETS.flatMap((_m, i) => [
          {
            address: reserveParsed[i].aTokenAddress,
            abi: ATOKEN_ABI,
            functionName: "balanceOf" as const,
            args: [address!] as const,
          },
          {
            address: reserveParsed[i].variableDebtTokenAddress,
            abi: VARIABLE_DEBT_TOKEN_ABI,
            functionName: "balanceOf" as const,
            args: [address!] as const,
          },
        ])
      : [];

  const balanceResult = useReadContracts({
    contracts: balanceContracts,
    query: { enabled: enabled && !!hasReserveData, refetchInterval: 10_000 },
  });

  // --- Combine ---
  const positions: UserMarketPosition[] = MARKETS.map((m, i) => {
    const supplied = safeBigInt(balanceResult.data?.[i * 2]?.result);
    const borrowed = safeBigInt(balanceResult.data?.[i * 2 + 1]?.result);
    const collEnabled = isCollateralEnabled(m.asset);

    return {
      asset: m.asset,
      symbol: m.symbol,
      decimals: m.decimals,
      supplied,
      borrowed,
      collateral: collEnabled ? supplied : 0n,
      collateralEnabled: collEnabled,
    };
  });

  return {
    positions,
    accountData,
    isLoading: reserveResult.isLoading || balanceResult.isLoading || accountResult.isLoading,
    isConnected: !!address,
  };
}
