"use client";

import { useCallback, useMemo } from "react";
import { useReadContract } from "wagmi";
import { AAVE_ORACLE_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";

/**
 * On-chain Aave oracle prices (USD, 8 decimals) keyed by lowercase asset address.
 * Used for leverage minAmountOut quotes — CoinGecko is display-only.
 */
export function useOraclePrices() {
  const assets = useMemo(() => MARKETS.map((market) => market.asset), []);
  const query = useReadContract({
    address: ADDRESSES.oracle,
    abi: AAVE_ORACLE_ABI,
    functionName: "getAssetsPrices",
    args: [assets],
    query: { ...QUERY.prices },
  });

  const prices = useMemo(() => {
    const map = new Map<string, bigint>();
    const raw = query.data;
    if (!raw) return map;
    for (let i = 0; i < MARKETS.length; i++) {
      const price = raw[i];
      if (typeof price === "bigint" && price > 0n) {
        map.set(MARKETS[i].asset.toLowerCase(), price);
      }
    }
    return map;
  }, [query.data]);

  const priceOf = useCallback(
    (asset: `0x${string}` | undefined) => (asset ? prices.get(asset.toLowerCase()) : undefined),
    [prices],
  );

  return {
    priceOf,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
