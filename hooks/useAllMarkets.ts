import { useReadContracts } from "wagmi";
import { LENDING_POOL_ABI, ADDRESSES } from "@/lib/contracts";
import { MARKETS, type MarketConfig } from "@/lib/constants";

export interface MarketInfo extends MarketConfig {
  totalSupply: bigint;
  totalBorrow: bigint;
  reserves: bigint;
  borrowRate: bigint;
  supplyRate: bigint;
}

export function useAllMarkets() {
  const contracts = MARKETS.map((m) => ({
    address: ADDRESSES.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "getMarketData" as const,
    args: [m.asset] as const,
  }));

  const result = useReadContracts({ contracts });

  const markets: MarketInfo[] = MARKETS.map((m, i) => {
    const data = result.data?.[i]?.result as
      | [bigint, bigint, bigint, bigint, bigint]
      | undefined;
    return {
      ...m,
      totalSupply: data?.[0] ?? 0n,
      totalBorrow: data?.[1] ?? 0n,
      reserves: data?.[2] ?? 0n,
      borrowRate: data?.[3] ?? 0n,
      supplyRate: data?.[4] ?? 0n,
    };
  });

  return { markets, isLoading: result.isLoading, error: result.error };
}
