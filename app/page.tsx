"use client";

import { StatCard } from "@/components/common/StatCard";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { MarketTable } from "@/components/markets/MarketTable";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { usePrices } from "@/hooks/usePrices";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

function formatAggregateUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

export default function Dashboard() {
  const { markets, isLoading } = useAllMarkets();
  const { healthFactor } = useHealthFactor();
  const { isConnected } = useAccount();
  const { data: prices } = usePrices();

  // Calculate USD-denominated totals by multiplying each market's token amounts by price
  const totalSupplyUsd = markets.reduce((sum, m) => {
    const price = prices?.[m.symbol] ?? 0;
    return sum + Number(formatUnits(m.totalSupply, m.decimals)) * price;
  }, 0);

  const totalBorrowUsd = markets.reduce((sum, m) => {
    const price = prices?.[m.symbol] ?? 0;
    return sum + Number(formatUnits(m.totalBorrow, m.decimals)) * price;
  }, 0);

  const tvlUsd = totalSupplyUsd - totalBorrowUsd;

  return (
    <div className="space-y-8">
      <div className="animate-in">
        <h1 className="text-3xl font-bold mb-1 text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Protocol overview</p>
      </div>

      {/* Protocol Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="animate-in-delay-1">
          <StatCard label="TVL" value={isLoading ? "..." : formatAggregateUsd(tvlUsd)} />
        </div>
        <div className="animate-in-delay-2">
          <StatCard label="Total Supply" value={isLoading ? "..." : formatAggregateUsd(totalSupplyUsd)} />
        </div>
        <div className="animate-in-delay-3">
          <StatCard label="Total Borrows" value={isLoading ? "..." : formatAggregateUsd(totalBorrowUsd)} />
        </div>
        <div className="animate-in-delay-4">
          <StatCard label="Markets" value={String(markets.length)} />
        </div>
      </div>

      {/* User Position (if connected) */}
      {isConnected && healthFactor && (
        <Card className="animate-in">
          <CardHeader>
            <CardTitle>Your Position</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-w-sm">
              <HealthFactorBar healthFactor={healthFactor} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Markets Table */}
      <div className="animate-in-delay-4">
        <h2 className="text-lg font-semibold mb-4 text-foreground">Markets</h2>
        {isLoading ? (
          <div className="text-muted-foreground">Loading markets...</div>
        ) : (
          <MarketTable markets={markets} />
        )}
      </div>
    </div>
  );
}
