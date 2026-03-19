"use client";

import { MarketTable } from "@/components/markets/MarketTable";
import { useAllMarkets } from "@/hooks/useAllMarkets";

export default function MarketsPage() {
  const { markets, isLoading } = useAllMarkets();

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-3xl font-bold mb-1 text-text-primary">Markets</h1>
        <p className="text-text-secondary">Supply assets to earn yield or borrow against collateral</p>
      </div>
      {isLoading ? (
        <div className="text-text-secondary">Loading...</div>
      ) : (
        <div className="animate-in-delay-1">
          <MarketTable markets={markets} />
        </div>
      )}
    </div>
  );
}
