"use client";

import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import { AAVE_ORACLE_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";

// CoinGecko IDs for our tokens
const COINGECKO_IDS: Record<string, string> = {
  LIT: "lighter",
  USDC: "usd-coin",
  ETH: "ethereum",
};

/**
 * Fetches asset prices from CoinGecko (real market prices) with on-chain oracle fallback.
 * Returns a Record<string, number> keyed by symbol (e.g., { LIT: 1.25, USDC: 1, ETH: 2000 })
 */
export function usePrices() {
  const [cgPrices, setCgPrices] = useState<Record<string, number> | undefined>();

  // CoinGecko fetch
  useEffect(() => {
    const ids = Object.values(COINGECKO_IDS).join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;

    async function fetchPrices() {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        const mapped: Record<string, number> = {};
        for (const [symbol, cgId] of Object.entries(COINGECKO_IDS)) {
          if (data[cgId]?.usd) mapped[symbol] = data[cgId].usd;
        }
        if (Object.keys(mapped).length > 0) setCgPrices(mapped);
      } catch { /* CoinGecko unavailable, fallback to oracle */ }
    }

    fetchPrices();
    const interval = setInterval(fetchPrices, 60_000);
    return () => clearInterval(interval);
  }, []);

  // On-chain oracle fallback
  const assets = MARKETS.map((m) => m.asset);
  const oracleResult = useReadContract({
    address: ADDRESSES.oracle as `0x${string}`,
    abi: AAVE_ORACLE_ABI,
    functionName: "getAssetsPrices",
    args: [assets],
    query: { refetchInterval: 30_000 },
  });

  let oraclePrices: Record<string, number> | undefined;
  try {
    const raw = oracleResult.data;
    if (raw && Array.isArray(raw)) {
      oraclePrices = MARKETS.reduce(
        (acc, m, i) => {
          acc[m.symbol] = Number(raw[i] as bigint) / 1e8;
          return acc;
        },
        {} as Record<string, number>,
      );
    }
  } catch {
    oraclePrices = undefined;
  }

  // Prefer CoinGecko, fallback to oracle
  const prices = cgPrices ?? oraclePrices;

  return {
    data: prices,
    isLoading: !cgPrices && oracleResult.isLoading,
    error: !cgPrices ? oracleResult.error : undefined,
  };
}
