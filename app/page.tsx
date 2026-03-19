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
      <div>
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-slate-400">Protocol overview</p>
      </div>

      {/* Protocol Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="TVL" value={isLoading ? "..." : formatUsd(tvl)} />
        <StatCard label="Total Supply" value={isLoading ? "..." : formatUsd(totalSupply)} />
        <StatCard label="Total Borrows" value={isLoading ? "..." : formatUsd(totalBorrow)} />
        <StatCard label="Markets" value={String(markets.length)} />
      </div>

      {/* User Position (if connected) */}
      {isConnected && healthFactor && (
        <div className="bg-brand-card border border-brand-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Your Position</h2>
          <div className="max-w-sm">
            <HealthFactorBar healthFactor={healthFactor} />
          </div>
        </div>
      )}

      {/* Markets Table */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Markets</h2>
        {isLoading ? (
          <div className="text-slate-400">Loading markets...</div>
        ) : (
          <MarketTable markets={markets} />
        )}
      </div>
    </div>
  );
}
