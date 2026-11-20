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
import { EnableCollateralModal } from "@/components/actions/EnableCollateralModal";
import { GuardNotice } from "@/components/common/GuardNotice";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useUserCollateralStatus } from "@/hooks/useUserCollateralStatus";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { resultAt, useLuminaMulticall } from "@/hooks/chain";
import { getMarketBySymbol } from "@/lib/constants";
import { QUERY } from "@/lib/queryPolicy";
import { formatPercent } from "@/lib/format";
import { formatUsd, usdValue } from "@/lib/prices";
import { INTEREST_RATE_STRATEGY_V2_ABI } from "@/lib/abis";

const RAY = 1e27;

export default function MarketDetailPage() {
  const { asset } = useParams<{ asset: string }>();
  const market = getMarketBySymbol(asset);
  const { getMarket } = useAllMarkets();
  const info = market ? getMarket(market.asset) : undefined;
  const { priceOf } = useOraclePrices();
  const { isCollateralEnabled } = useUserCollateralStatus();
  const cfg = info?.config;
  const risk = cfg
    ? {
        ltv: `${(cfg.ltv / 100).toFixed(0)}%`,
        liqThreshold: `${(cfg.liquidationThreshold / 100).toFixed(0)}%`,
        liqBonus: `${((cfg.liquidationBonus - 10000) / 100).toFixed(0)}%`,
      }
    : { ltv: "--", liqThreshold: "--", liqBonus: "--" };

  // Rate curve from the reserve's DefaultReserveInterestRateStrategyV2 (per-reserve params, ray).
  const strategy = info?.interestRateStrategy ?? null;
  const strategyRead = useLuminaMulticall(
    market
      ? (["getBaseVariableBorrowRate", "getVariableRateSlope1", "getVariableRateSlope2", "getOptimalUsageRatio"] as const).map(
          (functionName) => ({ address: strategy, abi: INTEREST_RATE_STRATEGY_V2_ABI, functionName, args: [market.asset] }),
        )
      : [],
    { enabled: !!market && !!strategy, policy: QUERY.market },
  );

  const [modal, setModal] = useState<"supply" | "borrow" | "withdraw" | "repay" | "collateral" | null>(null);

  if (!market) {
    return <div className="text-muted-foreground">Market not found</div>;
  }

  const supplyRate = info?.supplyRate ?? 0n;
  const borrowRate = info?.borrowRate ?? 0n;
  const totalSupply = info?.totalSupply ?? 0n;
  const totalBorrow = info?.totalBorrow ?? 0n;
  const reserves = info?.accruedToTreasury ?? 0n;

  const util = totalSupply > 0n
    ? Number((totalBorrow * 10000n) / totalSupply) / 100
    : 0;

  const price = priceOf(market.asset);

  // FE-13: no invented curve; show "unavailable" when the strategy cannot be read.
  const strategyValues = [0, 1, 2, 3].map((i) => resultAt<bigint>(strategyRead.results, i));
  const chartParams = strategyValues.every((v) => v !== undefined)
    ? {
        baseRate: Number(strategyValues[0]) / RAY,
        slope1: Number(strategyValues[1]) / RAY,
        slope2: Number(strategyValues[2]) / RAY,
        optimalUtil: Number(strategyValues[3]) / RAY,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link href="/markets" className="text-accent hover:text-white text-xs font-mono uppercase tracking-wider transition-colors inline-flex items-center gap-2">
        &larr; Back to Markets
      </Link>

      {/* Header: token icon + symbol + name */}
      <div className="flex items-center gap-4 animate-in">
        <TokenIcon symbol={market.symbol} size={48} />
        <div>
          <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text">{market.symbol} Market</h1>
          <p className="text-muted-foreground text-sm">{market.name}</p>
        </div>
      </div>

      <GuardNotice venue="core" />

      {/* Top stat cards */}
      <div className="grid md:grid-cols-3 gap-4 animate-in-delay-1">
        <StatCard label="Supply APY" value={formatPercent(supplyRate)} />
        <StatCard label="Borrow APY" value={formatPercent(borrowRate)} />
        <StatCard label="Utilization" value={`${util.toFixed(1)}%`} />
      </div>

      {/* Risk parameters */}
      <div className="animate-in-delay-1">
        <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent mb-4">Risk Parameters</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <StatCard label="LTV" value={risk.ltv} />
          <StatCard label="Liquidation Threshold" value={risk.liqThreshold} />
          <StatCard label="Liquidation Bonus" value={risk.liqBonus} />
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Left column: more stats + rate curve */}
        <div className="space-y-4 animate-in-delay-2">
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Total Supplied" value={formatUsd(usdValue(totalSupply, market.decimals, price))} />
            <StatCard label="Total Borrowed" value={formatUsd(usdValue(totalBorrow, market.decimals, price))} />
          </div>
          <StatCard label="Reserves" value={formatUsd(usdValue(reserves, market.decimals, price))} />
          {chartParams ? (
            <RateCurveChart {...chartParams} currentUtil={util} />
          ) : (
            <div className="technical-border bg-card p-4 text-sm text-muted-foreground">Rate curve unavailable</div>
          )}
        </div>

        {/* Right column: action buttons */}
        <div className="technical-border bg-card animate-in-delay-3 h-fit">
          <div className="p-6">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent mb-6">Actions</h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                className="h-12 bg-accent text-background font-bold uppercase tracking-[0.2em] text-xs hover:bg-white shadow-[0_0_20px_rgba(176,196,255,0.2)] transition-colors"
                onClick={() => setModal("supply")}
              >
                Supply
              </button>
              <button
                className="h-12 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-colors"
                onClick={() => setModal("borrow")}
              >
                Borrow
              </button>
              <button
                className="h-12 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-colors"
                onClick={() => setModal("withdraw")}
              >
                Withdraw
              </button>
              <button
                className="h-12 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-colors"
                onClick={() => setModal("repay")}
              >
                Repay
              </button>
              <button
                className="h-12 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background col-span-2 transition-colors"
                onClick={() => setModal("collateral")}
              >
                {isCollateralEnabled(market.asset) ? "Disable Collateral" : "Enable as Collateral"}
              </button>
            </div>
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
      {modal === "collateral" && (
        <EnableCollateralModal
          asset={market.asset}
          symbol={market.symbol}
          currentlyEnabled={isCollateralEnabled(market.asset)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
