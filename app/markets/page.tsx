"use client";

import { MarketTable } from "@/components/markets/MarketTable";
import { useAllMarkets } from "@/hooks/useAllMarkets";

export default function MarketsPage() {
  const { markets, isLoading } = useAllMarkets();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Markets</h1>
        <p className="text-slate-400">Supply assets to earn yield or borrow against collateral</p>
      </div>
      {isLoading ? (
        <div className="text-slate-400">Loading...</div>
      ) : (
        <MarketTable markets={markets} />
      )}
    </div>
  );
}
