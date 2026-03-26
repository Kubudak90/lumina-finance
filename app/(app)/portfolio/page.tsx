"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { SupplyTable } from "@/components/portfolio/SupplyTable";
import { BorrowTable } from "@/components/portfolio/BorrowTable";
import { CollateralTable } from "@/components/portfolio/CollateralTable";
import { useUserPosition } from "@/hooks/useUserPosition";
import { usePrices } from "@/hooks/usePrices";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useReserveConfig } from "@/hooks/useReserveConfig";
import { getMarketBySymbol, type MarketConfig } from "@/lib/constants";
import { formatPercent } from "@/lib/format";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { RepayModal } from "@/components/actions/RepayModal";

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const { positions, accountData, isLoading: positionsLoading } = useUserPosition();
  const healthFactor = accountData?.healthFactor;
  const { data: prices } = usePrices();
  const { markets } = useAllMarkets();
  const { getConfig } = useReserveConfig();
  const [modal, setModal] = useState<{ type: "withdraw" | "repay"; market: MarketConfig } | null>(null);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-4">Portfolio</h1>
        <p className="text-muted-foreground mb-6">Connect your wallet to view your positions</p>
      </div>
    );
  }

  if (positionsLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-4">Portfolio</h1>
        <p className="text-muted-foreground mb-6">Loading positions...</p>
      </div>
    );
  }

  const totalSuppliedUsd = positions.reduce((acc, p) => {
    const price = prices?.[p.symbol] ?? 0;
    return acc + Number(formatUnits(p.supplied, p.decimals)) * price;
  }, 0);

  const totalBorrowedUsd = positions.reduce((acc, p) => {
    const price = prices?.[p.symbol] ?? 0;
    return acc + Number(formatUnits(p.borrowed, p.decimals)) * price;
  }, 0);

  const netWorth = totalSuppliedUsd - totalBorrowedUsd;

  const supplies = positions
    .filter((p) => p.supplied > 0n)
    .map((p) => {
      const mInfo = markets.find((m) => m.symbol === p.symbol);
      return {
        symbol: p.symbol,
        balance: formatUnits(p.supplied, p.decimals),
        value: `$${(Number(formatUnits(p.supplied, p.decimals)) * (prices?.[p.symbol] ?? 0)).toFixed(2)}`,
        apy: mInfo ? formatPercent(mInfo.supplyRate) : "—",
      };
    });

  const borrows = positions
    .filter((p) => p.borrowed > 0n)
    .map((p) => {
      const mInfo = markets.find((m) => m.symbol === p.symbol);
      return {
        symbol: p.symbol,
        debt: formatUnits(p.borrowed, p.decimals),
        value: `$${(Number(formatUnits(p.borrowed, p.decimals)) * (prices?.[p.symbol] ?? 0)).toFixed(2)}`,
        apy: mInfo ? formatPercent(mInfo.borrowRate) : "—",
      };
    });

  const collateral = positions
    .filter((p) => p.collateral > 0n)
    .map((p) => {
      const cfg = getConfig(p.symbol);
      return {
        symbol: p.symbol,
        amount: formatUnits(p.collateral, p.decimals),
        value: `$${(Number(formatUnits(p.collateral, p.decimals)) * (prices?.[p.symbol] ?? 0)).toFixed(2)}`,
        ltv: cfg ? `${(cfg.ltv / 100).toFixed(0)}%` : "—",
      };
    });

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text">Portfolio</h1>
        {healthFactor && (
          <div className="w-64">
            <HealthFactorBar healthFactor={healthFactor} />
          </div>
        )}
      </div>

      {/* Net Worth Summary */}
      <div className="grid md:grid-cols-3 gap-4 animate-in">
        <div className="technical-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Total Supplied</div>
          <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
            ${totalSuppliedUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="technical-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Total Borrowed</div>
          <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
            ${totalBorrowedUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="technical-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Net Worth</div>
          <div className={`text-2xl font-bold font-mono tracking-tight ${netWorth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            ${netWorth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {/* Claim Rewards */}
      <div className="technical-border bg-card p-4 animate-in">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">Rewards</div>
            <div className="text-foreground text-sm">No rewards available</div>
          </div>
          <button
            disabled
            className="h-10 px-6 bg-accent text-background font-bold uppercase tracking-[0.2em] text-[10px] shadow-[0_0_20px_rgba(176,196,255,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Claim Rewards
          </button>
        </div>
      </div>

      <div className="technical-border bg-card animate-in-delay-1">
        <div className="p-4 border-b border-border/50">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Your Supplies</h2>
        </div>
        <div className="p-4">
          <SupplyTable rows={supplies} onWithdraw={(symbol) => {
            const m = getMarketBySymbol(symbol);
            if (m) setModal({ type: "withdraw", market: m });
          }} />
        </div>
      </div>

      <div className="technical-border bg-card animate-in-delay-2">
        <div className="p-4 border-b border-border/50">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Your Borrows</h2>
        </div>
        <div className="p-4">
          <BorrowTable rows={borrows} onRepay={(symbol) => {
            const m = getMarketBySymbol(symbol);
            if (m) setModal({ type: "repay", market: m });
          }} />
        </div>
      </div>

      <div className="technical-border bg-card animate-in-delay-3">
        <div className="p-4 border-b border-border/50">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Your Collateral</h2>
        </div>
        <div className="p-4">
          <CollateralTable rows={collateral} />
        </div>
      </div>

      {modal?.type === "withdraw" && (
        <WithdrawModal
          asset={modal.market.asset}
          symbol={modal.market.symbol}
          decimals={modal.market.decimals}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "repay" && (
        <RepayModal
          asset={modal.market.asset}
          symbol={modal.market.symbol}
          decimals={modal.market.decimals}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
