import { useReadContracts, useAccount } from "wagmi";
import { DATA_PROVIDER_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";

export interface UserReserveInfo {
  symbol: string;
  asset: `0x${string}`;
  currentATokenBalance: bigint;
  currentVariableDebt: bigint;
  usageAsCollateralEnabled: boolean;
  liquidityRate: bigint;
}

/**
 * Reads per-market user data via DataProvider.getUserReserveData.
 * Returns real collateral-enabled flag, aToken balance, variable debt, etc.
 */
export function useUserCollateralStatus() {
  const { address } = useAccount();
  const enabled = !!address;

  const contracts = enabled
    ? MARKETS.map((m) => ({
        address: ADDRESSES.dataProvider as `0x${string}`,
        abi: DATA_PROVIDER_ABI,
        functionName: "getUserReserveData" as const,
        args: [m.asset, address!] as const,
      }))
    : [];

  const result = useReadContracts({
    contracts,
    query: { enabled, refetchInterval: 10_000 },
  });

  const userReserves: UserReserveInfo[] = MARKETS.map((m, i) => {
    const defaults: UserReserveInfo = {
      symbol: m.symbol,
      asset: m.asset,
      currentATokenBalance: 0n,
      currentVariableDebt: 0n,
      usageAsCollateralEnabled: false,
      liquidityRate: 0n,
    };

    try {
      const raw = result.data?.[i]?.result;
      if (!raw) return defaults;

      // getUserReserveData returns:
      // (currentATokenBalance, currentStableDebt, currentVariableDebt,
      //  principalStableDebt, scaledVariableDebt, stableBorrowRate,
      //  liquidityRate, stableRateLastUpdated, usageAsCollateralEnabled)
      const d = raw as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
      return {
        symbol: m.symbol,
        asset: m.asset,
        currentATokenBalance: d[0],
        currentVariableDebt: d[2],
        usageAsCollateralEnabled: d[8],
        liquidityRate: d[6],
      };
    } catch (e) {
      console.warn("useUserCollateralStatus parse error:", e);
      return defaults;
    }
  });

  const isCollateralEnabled = (asset: string): boolean => {
    const info = userReserves.find((r) => r.asset.toLowerCase() === asset.toLowerCase());
    return info?.usageAsCollateralEnabled ?? false;
  };

  return {
    userReserves,
    isCollateralEnabled,
    isLoading: result.isLoading,
  };
}
