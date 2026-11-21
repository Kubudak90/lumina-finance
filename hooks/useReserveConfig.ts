"use client";

import { useAllMarkets } from "@/hooks/useAllMarkets";

/** Reserve risk config (LTV, LT, bonus …) per symbol, from the shared market read. */
export function useReserveConfig() {
  const { markets, isLoading } = useAllMarkets();
  const getConfig = (symbol: string) =>
    markets.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase())?.config;
  return { getConfig, isLoading };
}
