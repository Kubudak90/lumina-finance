"use client";

import { MarketTable } from "@/components/markets/MarketTable";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketsPage() {
  const { markets, isLoading } = useAllMarkets();

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">Markets</h1>
        <p className="text-muted-foreground text-sm">Supply assets to earn yield or borrow against collateral</p>
      </div>
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="animate-in-delay-1 technical-border bg-card">
          <MarketTable markets={markets} />
        </div>
      )}
    </div>
  );
}
