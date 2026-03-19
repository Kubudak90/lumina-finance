"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TokenIcon } from "@/components/common/TokenIcon";
import { StatCard } from "@/components/common/StatCard";
import { RateCurveChart } from "@/components/markets/RateCurveChart";
import { SupplyModal } from "@/components/actions/SupplyModal";
import { BorrowModal } from "@/components/actions/BorrowModal";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { RepayModal } from "@/components/actions/RepayModal";
import { useMarketData } from "@/hooks/useMarketData";
import { getMarketBySymbol } from "@/lib/constants";
import { formatUsd, formatPercent } from "@/lib/format";

export default function MarketDetailPage() {
  const { asset } = useParams<{ asset: string }>();
  const market = getMarketBySymbol(asset);
  const { data } = useMarketData(market?.asset ?? "0x0000000000000000000000000000000000000000");

  const [modal, setModal] = useState<"supply" | "borrow" | "withdraw" | "repay" | null>(null);

  if (!market) {
    return <div className="text-text-secondary">Market not found</div>;
  }

  const [totalSupply, totalBorrow, reserves, borrowRate, supplyRate] =
    (data as [bigint, bigint, bigint, bigint, bigint] | undefined) ??
    [0n, 0n, 0n, 0n, 0n];

  const util =
    totalSupply > 0n
      ? Number((totalBorrow * 10000n) / totalSupply) / 100
      : 0;

  // Kink model parameters — hardcoded for MVP, read from contract in production
  const isUsdc = market.symbol === "USDC";
  const chartParams = isUsdc
    ? { baseRate: 0.02, slope1: 0.04, slope2: 0.75, optimalUtil: 0.8 }
    : { baseRate: 0.01, slope1: 0.03, slope2: 1.0, optimalUtil: 0.7 };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/markets" className="text-brand-accent hover:underline text-sm font-medium">
        &larr; Back to Markets
      </Link>

      {/* Header: token icon + symbol + name */}
      <div className="flex items-center gap-4 animate-in">
        <TokenIcon symbol={market.symbol} size={48} />
        <div>
          <h1 className="text-3xl font-bold text-text-primary">{market.symbol} Market</h1>
          <p className="text-text-secondary">{market.name}</p>
        </div>
      </div>

      {/* Top stat cards */}
      <div className="grid md:grid-cols-3 gap-4 animate-in-delay-1">
        <StatCard label="Supply APY" value={formatPercent(supplyRate)} />
        <StatCard label="Borrow APY" value={formatPercent(borrowRate)} />
        <StatCard label="Utilization" value={`${util.toFixed(1)}%`} />
      </div>

      {/* Two-column layout */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Left column: more stats + rate curve */}
        <div className="space-y-4 animate-in-delay-2">
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Total Supplied" value={formatUsd(totalSupply)} />
            <StatCard label="Total Borrowed" value={formatUsd(totalBorrow)} />
          </div>
          <StatCard label="Reserves" value={formatUsd(reserves)} />
          <RateCurveChart {...chartParams} currentUtil={util} />
        </div>

        {/* Right column: action buttons */}
        <div className="bg-white border border-brand-border rounded-xl p-6 space-y-4 shadow-sm animate-in-delay-3">
          <h3 className="text-lg font-semibold text-text-primary">Actions</h3>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setModal("supply")}
              className="py-3 rounded-lg font-semibold bg-brand-accent text-white hover:bg-brand-accent-hover transition-colors"
            >
              Supply
            </button>
            <button
              onClick={() => setModal("borrow")}
              className="py-3 rounded-lg font-semibold border border-brand-accent text-brand-accent hover:bg-brand-accent/5 transition-colors"
            >
              Borrow
            </button>
            <button
              onClick={() => setModal("withdraw")}
              className="py-3 rounded-lg font-semibold border border-brand-border text-text-secondary hover:bg-gray-50 transition-colors"
            >
              Withdraw
            </button>
            <button
              onClick={() => setModal("repay")}
              className="py-3 rounded-lg font-semibold border border-brand-border text-text-secondary hover:bg-gray-50 transition-colors"
            >
              Repay
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal === "supply" && (
        <SupplyModal
          asset={market.asset}
          symbol={market.symbol}
          decimals={market.decimals}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "borrow" && (
        <BorrowModal
          asset={market.asset}
          symbol={market.symbol}
          decimals={market.decimals}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "withdraw" && (
        <WithdrawModal
          asset={market.asset}
          symbol={market.symbol}
          decimals={market.decimals}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "repay" && (
        <RepayModal
          asset={market.asset}
          symbol={market.symbol}
          decimals={market.decimals}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
