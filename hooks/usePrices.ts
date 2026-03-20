"use client";

import { useQuery } from "@tanstack/react-query";

interface PriceData {
  ethereum: { usd: number };
  "usd-coin": { usd: number };
}

async function fetchPrices(): Promise<Record<string, number>> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,usd-coin&vs_currencies=usd"
    );
    if (!res.ok) throw new Error("CoinGecko API error");
    const data: PriceData = await res.json();
    return {
      ETH: data.ethereum?.usd ?? 0,
      WETH: data.ethereum?.usd ?? 0,
      USDC: data["usd-coin"]?.usd ?? 1,
    };
  } catch {
    // Fallback prices if CoinGecko is down
    return { ETH: 2000, WETH: 2000, USDC: 1 };
  }
}

export function usePrices() {
  return useQuery({
    queryKey: ["coingecko-prices"],
    queryFn: fetchPrices,
    refetchInterval: 60_000, // refresh every 60s
    staleTime: 30_000,
  });
}
