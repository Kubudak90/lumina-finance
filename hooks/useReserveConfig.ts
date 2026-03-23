import { useReadContracts } from "wagmi";
import { DATA_PROVIDER_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";

export interface ReserveConfig {
  symbol: string;
  asset: `0x${string}`;
  ltv: number;                      // basis points (e.g. 8000 = 80%)
  liquidationThreshold: number;     // basis points
  liquidationBonus: number;         // basis points (e.g. 10500 = 5% bonus)
  reserveFactor: number;            // basis points
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
}

/**
 * Fetches reserve configuration for all markets from DataProvider.getReserveConfigurationData.
 * Returns LTV, liquidation threshold, liquidation bonus, etc. per market.
 */
export function useReserveConfig() {
  const contracts = MARKETS.map((m) => ({
    address: ADDRESSES.dataProvider as `0x${string}`,
    abi: DATA_PROVIDER_ABI,
    functionName: "getReserveConfigurationData" as const,
    args: [m.asset] as const,
  }));

  const result = useReadContracts({
    contracts,
    query: { refetchInterval: 60_000 },
  });

  const configs: ReserveConfig[] = MARKETS.map((m, i) => {
    const defaults: ReserveConfig = {
      symbol: m.symbol,
      asset: m.asset,
      ltv: 0,
      liquidationThreshold: 0,
      liquidationBonus: 0,
      reserveFactor: 0,
      usageAsCollateralEnabled: false,
      borrowingEnabled: false,
      isActive: false,
      isFrozen: false,
    };

    try {
      const raw = result.data?.[i]?.result;
      if (!raw) return defaults;

      // DataProvider.getReserveConfigurationData returns a tuple:
      // (decimals, ltv, liquidationThreshold, liquidationBonus, reserveFactor,
      //  usageAsCollateralEnabled, borrowingEnabled, stableBorrowRateEnabled, isActive, isFrozen)
      const d = raw as readonly [bigint, bigint, bigint, bigint, bigint, boolean, boolean, boolean, boolean, boolean];
      return {
        symbol: m.symbol,
        asset: m.asset,
        ltv: Number(d[1]),
        liquidationThreshold: Number(d[2]),
        liquidationBonus: Number(d[3]),
        reserveFactor: Number(d[4]),
        usageAsCollateralEnabled: d[5],
        borrowingEnabled: d[6],
        isActive: d[8],
        isFrozen: d[9],
      };
    } catch (e) {
      console.warn("useReserveConfig parse error:", e);
      return defaults;
    }
  });

  const getConfig = (symbol: string): ReserveConfig | undefined =>
    configs.find((c) => c.symbol.toLowerCase() === symbol.toLowerCase());

  return {
    configs,
    getConfig,
    isLoading: result.isLoading,
  };
}
