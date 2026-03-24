"use client";

import { useReadContract } from "wagmi";
import { AAVE_ORACLE_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";

/**
 * Fetches asset prices from the Aave V3 Oracle (AaveOracle.getAssetsPrices).
 *
 * The oracle returns prices in the market's base currency (typically USD with 8 decimals).
 * This hook returns a Record<string, number> keyed by symbol (e.g., { WETH: 2000, USDC: 1 })
 * matching the previous CoinGecko-based API shape so all consumers stay compatible.
 */
export function usePrices() {
  const assets = MARKETS.map((m) => m.asset);

  const result = useReadContract({
    address: ADDRESSES.oracle as `0x${string}`,
    abi: AAVE_ORACLE_ABI,
    functionName: "getAssetsPrices",
    args: [assets],
    query: { refetchInterval: 30_000 },
  });

  // Convert oracle prices (8 decimals) to plain numbers, keyed by symbol
  let prices: Record<string, number> | undefined;
  try {
    const raw = result.data;
    if (raw && Array.isArray(raw)) {
      prices = MARKETS.reduce(
        (acc, m, i) => {
          acc[m.symbol] = Number(raw[i] as bigint) / 1e8;
          return acc;
        },
        {} as Record<string, number>,
      );
    }
  } catch {
    prices = undefined;
  }

  return {
    data: prices,
    isLoading: result.isLoading,
    error: result.error,
  };
}
