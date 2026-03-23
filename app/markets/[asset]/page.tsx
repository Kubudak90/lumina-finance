"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useReadContracts } from "wagmi";
import { TokenIcon } from "@/components/common/TokenIcon";
import { StatCard } from "@/components/common/StatCard";
import { RateCurveChart } from "@/components/markets/RateCurveChart";
import { SupplyModal } from "@/components/actions/SupplyModal";
import { BorrowModal } from "@/components/actions/BorrowModal";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { RepayModal } from "@/components/actions/RepayModal";
import { EnableCollateralModal } from "@/components/actions/EnableCollateralModal";
import { useMarketData } from "@/hooks/useMarketData";
import { useUserCollateralStatus } from "@/hooks/useUserCollateralStatus";
import { usePrices } from "@/hooks/usePrices";
import { getMarketBySymbol } from "@/lib/constants";
import { formatTokenToUsd, formatPercent } from "@/lib/format";
import { ATOKEN_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

const RISK_PARAMS: Record<string, { ltv: string; liqThreshold: string; liqBonus: string; eMode?: string }> = {
  WETH: { ltv: "80%", liqThreshold: "85%", liqBonus: "5%" },
  USDC: { ltv: "85%", liqThreshold: "90%", liqBonus: "5%", eMode: "Stablecoins E-Mode" },
};

export default function MarketDetailPage() {
  const { asset } = useParams<{ asset: string }>();
  const market = getMarketBySymbol(asset);
  const { reserveData } = useMarketData(market?.asset ?? ZERO_ADDRESS);
  const { data: prices } = usePrices();
  const { isCollateralEnabled } = useUserCollateralStatus();

  // Read aToken + debtToken totalSupply for real supply/borrow amounts
  const tokenSupplies = useReadContracts({
    contracts: market ? [
      { address: market.aToken, abi: ATOKEN_ABI, functionName: "totalSupply" as const },
      { address: market.variableDebtToken, abi: VARIABLE_DEBT_TOKEN_ABI, functionName: "totalSupply" as const },
    ] : [],
    query: { enabled: !!market, refetchInterval: 15_000 },
  });

  const [modal, setModal] = useState<"supply" | "borrow" | "withdraw" | "repay" | "collateral" | null>(null);

  if (!market) {
    return <div className="text-muted-foreground">Market not found</div>;
  }

  const supplyRate = reserveData?.currentLiquidityRate ?? 0n;
  const borrowRate = reserveData?.currentVariableBorrowRate ?? 0n;
  const totalSupply = (tokenSupplies.data?.[0]?.result as bigint) ?? 0n;
  const totalBorrow = (tokenSupplies.data?.[1]?.result as bigint) ?? 0n;
  const reserves = reserveData?.accruedToTreasury ?? 0n;

  const util = totalSupply > 0n
    ? Number((totalBorrow * 10000n) / totalSupply) / 100
    : 0;

  const price = prices?.[market.symbol] ?? 0;
  const risk = RISK_PARAMS[market.symbol] ?? { ltv: "—", liqThreshold: "—", liqBonus: "—" };

  const chartParams = {
    baseRate: 0.02,
    slope1: 0.04,
    slope2: 0.75,
    optimalUtil: 0.80,
  };

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

      {/* E-Mode badge */}
      {risk.eMode && (
        <div className="animate-in-delay-1">
          <span className="inline-flex items-center gap-1.5 border border-accent/30 px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-accent">
            <span className="inline-block h-1.5 w-1.5 bg-accent" />
            {risk.eMode}
          </span>
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Left column: more stats + rate curve */}
        <div className="space-y-4 animate-in-delay-2">
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Total Supplied" value={formatTokenToUsd(totalSupply, price, market.decimals)} />
            <StatCard label="Total Borrowed" value={formatTokenToUsd(totalBorrow, price, market.decimals)} />
          </div>
          <StatCard label="Reserves" value={formatTokenToUsd(reserves, price, market.decimals)} />
          <RateCurveChart {...chartParams} currentUtil={util} />
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
          decimals={market.decimals}
          currentlyEnabled={isCollateralEnabled(market.asset)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
