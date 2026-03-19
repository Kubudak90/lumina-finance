"use client";

import { StatCard } from "@/components/common/StatCard";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { MarketTable } from "@/components/markets/MarketTable";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { useAccount } from "wagmi";
import { formatUsd } from "@/lib/format";

export default function Dashboard() {
  const { markets, isLoading } = useAllMarkets();
  const { healthFactor } = useHealthFactor();
  const { isConnected } = useAccount();

  const totalSupply = markets.reduce((sum, m) => sum + m.totalSupply, 0n);
  const totalBorrow = markets.reduce((sum, m) => sum + m.totalBorrow, 0n);
  const tvl = totalSupply - totalBorrow;

  return (
    <div className="space-y-8">
      <div className="animate-in">
        <h1 className="text-3xl font-bold mb-1 text-text-primary">Dashboard</h1>
        <p className="text-text-secondary">Protocol overview</p>
      </div>

      {/* Protocol Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="animate-in-delay-1">
          <StatCard label="TVL" value={isLoading ? "..." : formatUsd(tvl)} />
        </div>
        <div className="animate-in-delay-2">
          <StatCard label="Total Supply" value={isLoading ? "..." : formatUsd(totalSupply)} />
        </div>
        <div className="animate-in-delay-3">
          <StatCard label="Total Borrows" value={isLoading ? "..." : formatUsd(totalBorrow)} />
        </div>
        <div className="animate-in-delay-4">
          <StatCard label="Markets" value={String(markets.length)} />
        </div>
      </div>

      {/* User Position (if connected) */}
      {isConnected && healthFactor && (
        <div className="bg-white border border-brand-border rounded-xl p-6 shadow-sm animate-in">
          <h2 className="text-lg font-semibold mb-4 text-text-primary">Your Position</h2>
          <div className="max-w-sm">
            <HealthFactorBar healthFactor={healthFactor} />
          </div>
        </div>
      )}

      {/* Markets Table */}
      <div className="animate-in-delay-4">
        <h2 className="text-lg font-semibold mb-4 text-text-primary">Markets</h2>
        {isLoading ? (
          <div className="text-text-secondary">Loading markets...</div>
        ) : (
          <MarketTable markets={markets} />
        )}
      </div>
    </div>
  );
}
