"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { SupplyTable } from "@/components/portfolio/SupplyTable";
import { BorrowTable } from "@/components/portfolio/BorrowTable";
import { CollateralTable } from "@/components/portfolio/CollateralTable";
import { IsolatedPositionsTable } from "@/components/portfolio/IsolatedPositionsTable";
import { FreshnessBadge } from "@/components/portfolio/FreshnessBadge";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useUserIsolatedPositions } from "@/hooks/useUserIsolatedPositions";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { getMarketBySymbol, type MarketConfig } from "@/lib/constants";
import { formatPercent } from "@/lib/format";
import { formatUsd, usdValue } from "@/lib/prices";
import { coreLegsUsd, isolatedLegsUsd, oldestStamp } from "@/lib/valuation";
import { chainFreshness, type LuminaLegs } from "@/lib/portfolio/combine";
import { useFreshnessNow } from "@/lib/portfolio/clock";
import { STALE_AFTER_SECONDS } from "@/lib/queryPolicy";
import { NETWORK_NAME } from "@/lib/chains";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { RepayModal } from "@/components/actions/RepayModal";

const LighterPortfolioEmbed = dynamic(
  () => import("@/lib/lighter/runtime/session").then((mod) => mod.LighterPortfolioEmbed),
  {
    ssr: false,
    loading: () => <p className="text-sm text-text-dim">Loading Lighter…</p>,
  }
);

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const { positions, accountData, stamp, isLoading: positionsLoading } = useUserPosition();
  const {
    positions: isolatedPositions,
    incomplete: isolatedIncomplete,
    stamp: isolatedStamp,
    conversionStamp,
    pairsStamp,
    isLoading: isolatedLoading,
  } = useUserIsolatedPositions();
  const healthFactor = accountData?.healthFactor;
  const { priceOf, stamp: priceStamp } = useOraclePrices();
  const { markets } = useAllMarkets();
  const now = useFreshnessNow();
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

  // FE-06: core legs priced by AaveOracle.getAssetPrice (keyed by asset address); isolated
  // collateral converted through the pair oracle's exchange rate in one division. A failed read
  // makes the affected total unavailable (Codex #9).
  const core = coreLegsUsd(positions, priceOf);
  const iso = isolatedLegsUsd(isolatedPositions, priceOf, isolatedIncomplete);
  const totalSuppliedUsd = core.supplied;
  const totalBorrowedUsd = core.borrowed;
  const isolatedSupplyUsd = iso.supply;
  const isolatedDebtUsd = iso.debt;
  const isolatedCollateralTotal = iso.collateral;
  // Each valuation is as old as the oldest read it combines.
  const poolValuationStamp = oldestStamp([stamp, priceStamp]);
  const isolatedValuationStamp = oldestStamp([isolatedStamp, conversionStamp, pairsStamp, priceStamp]);

  const legs = [totalSuppliedUsd, totalBorrowedUsd, isolatedSupplyUsd, isolatedDebtUsd, isolatedCollateralTotal];
  // The unified Lighter view needs every leg; it gets nothing rather than a silently wrong total.
  const lumina: LuminaLegs | null = legs.every((v) => v !== undefined)
    ? {
        poolSupplyUsd: totalSuppliedUsd!,
        poolDebtUsd: totalBorrowedUsd!,
        isolatedSupplyUsd: isolatedSupplyUsd!,
        isolatedDebtUsd: isolatedDebtUsd!,
        isolatedCollateralUsd: isolatedCollateralTotal!,
      }
    : null;

  const netWorth =
    totalSuppliedUsd !== undefined && totalBorrowedUsd !== undefined ? totalSuppliedUsd - totalBorrowedUsd : undefined;
  const luminaStatus = chainFreshness(poolValuationStamp?.timestamp, now, STALE_AFTER_SECONDS);
  const isolatedStatus = chainFreshness(isolatedValuationStamp?.timestamp, now, STALE_AFTER_SECONDS);

  const supplies = positions
    .filter((p): p is typeof p & { supplied: bigint } => p.supplied !== undefined && p.supplied > 0n)
    .map((p) => {
      const mInfo = markets.find((m) => m.symbol === p.symbol);
      return {
        symbol: p.symbol,
        balance: formatUnits(p.supplied, p.decimals),
        value: formatUsd(usdValue(p.supplied, p.decimals, priceOf(p.asset))),
        apy: mInfo ? formatPercent(mInfo.supplyRate) : "—",
      };
    });

  const borrows = positions
    .filter((p): p is typeof p & { borrowed: bigint } => p.borrowed !== undefined && p.borrowed > 0n)
    .map((p) => {
      const mInfo = markets.find((m) => m.symbol === p.symbol);
      return {
        symbol: p.symbol,
        debt: formatUnits(p.borrowed, p.decimals),
        value: formatUsd(usdValue(p.borrowed, p.decimals, priceOf(p.asset))),
        apy: mInfo ? formatPercent(mInfo.borrowRate) : "—",
      };
    });

  const collateral = positions
    .filter((p): p is typeof p & { collateral: bigint } => p.collateral !== undefined && p.collateral > 0n)
    .map((p) => {
      const cfg = markets.find((m) => m.asset.toLowerCase() === p.asset.toLowerCase())?.config;
      return {
        symbol: p.symbol,
        amount: formatUnits(p.collateral, p.decimals),
        value: formatUsd(usdValue(p.collateral, p.decimals, priceOf(p.asset))),
        ltv: cfg ? `${(cfg.ltv / 100).toFixed(0)}%` : "—",
      };
    });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text">Portfolio</h1>
        <div className="flex flex-wrap items-center gap-3">
          <FreshnessBadge source="Lumina pool" status={luminaStatus} detail={NETWORK_NAME} />
          <FreshnessBadge source="Isolated" status={isolatedStatus} detail="on-chain" />
          {healthFactor !== undefined && (
            <div className="w-64">
              <HealthFactorBar healthFactor={healthFactor} />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <FreshnessStamp stamp={poolValuationStamp} label="Pool valuation" />
        <FreshnessStamp stamp={isolatedValuationStamp} label="Isolated valuation" />
      </div>

      {lumina ? (
        <LighterPortfolioEmbed lumina={lumina} />
      ) : (
        <p className="text-sm text-text-dim">Unified view unavailable until every on-chain price has loaded.</p>
      )}

      <div className="grid md:grid-cols-3 gap-4 animate-in">
        <div className="technical-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Total Supplied</div>
          <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
            {formatUsd(totalSuppliedUsd)}
          </div>
        </div>
        <div className="technical-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Total Borrowed</div>
          <div className="text-2xl font-bold font-mono tracking-tight text-foreground">
            {formatUsd(totalBorrowedUsd)}
          </div>
        </div>
        <div className="technical-border bg-card p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">Pool net</div>
          <div className={`text-2xl font-bold font-mono tracking-tight ${netWorth === undefined || netWorth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {formatUsd(netWorth)}
          </div>
        </div>
      </div>

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

      <div className="technical-border bg-card">
        <div className="p-4 border-b border-border/50">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Isolated positions</h2>
        </div>
        <div className="p-4">
          {isolatedLoading ? (
            <p className="text-sm text-muted-foreground">Loading isolated pairs…</p>
          ) : (
            <IsolatedPositionsTable positions={isolatedPositions} />
          )}
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
