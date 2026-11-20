"use client";

import { useState } from "react";
import { TokenIcon } from "@/components/common/TokenIcon";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { useAccount } from "wagmi";
import { formatPercent, formatHealthFactor, formatTokenAmount, MAX_HEALTH_FACTOR } from "@/lib/format";
import { formatUsd, sumUsd, usdValue } from "@/lib/prices";
import { Skeleton } from "@/components/ui/skeleton";
import { SupplyModal } from "@/components/actions/SupplyModal";
import { BorrowModal } from "@/components/actions/BorrowModal";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { RepayModal } from "@/components/actions/RepayModal";
import { EnableCollateralModal } from "@/components/actions/EnableCollateralModal";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { GuardNotice } from "@/components/common/GuardNotice";
import { DeploymentNotice } from "@/components/common/DeploymentNotice";
import { MARKETS, type MarketConfig } from "@/lib/constants";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  Shield,
  Search,
} from "lucide-react";

type ModalState =
  | { type: "supply" | "borrow" | "withdraw" | "repay" | "collateral"; market: MarketConfig }
  | null;

export default function Dashboard() {
  const { markets, isLoading } = useAllMarkets();
  const { positions, accountData, stamp } = useUserPosition();
  const healthFactor = accountData?.healthFactor;
  const { priceOf } = useOraclePrices();
  const { isConnected: walletConnected } = useAccount();
  const isCollateralEnabled = (asset: string) =>
    positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase())?.collateralEnabled ?? false;
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);

  // USD totals from AaveOracle prices (FE-06); "—" if a needed price is unavailable.
  const userTotalSupplied = sumUsd(positions.map((p) => usdValue(p.supplied, p.decimals, priceOf(p.asset))));
  const userTotalBorrowed = sumUsd(positions.map((p) => usdValue(p.borrowed, p.decimals, priceOf(p.asset))));

  // HF
  const isMaxHf = healthFactor === MAX_HEALTH_FACTOR;
  const hfNum = healthFactor !== undefined ? (isMaxHf ? 99 : Number(healthFactor) / 1e18) : 0;
  const hfPercent = Math.min((hfNum / 5) * 100, 100);
  const hfColor = hfNum >= 2 ? "bg-emerald-500" : hfNum >= 1.2 ? "bg-amber-500" : "bg-rose-500";
  const hfTextColor = hfNum >= 2 ? "text-emerald-400" : hfNum >= 1.2 ? "text-amber-400" : "text-rose-400";

  // Borrow limit (LTV-based, base currency) from on-chain account data
  const borrowLimit = accountData
    ? Number(accountData.availableBorrowsBase + accountData.totalDebtBase) / 1e8
    : undefined;

  // Net worth
  const netWorth =
    userTotalSupplied !== undefined && userTotalBorrowed !== undefined
      ? userTotalSupplied - userTotalBorrowed
      : undefined;

  // Filter markets by search
  const filtered = MARKETS.filter(
    (m) =>
      m.symbol.toLowerCase().includes(search.toLowerCase()) ||
      m.name.toLowerCase().includes(search.toLowerCase())
  );

  // Find market data by asset
  const getMarketInfo = (asset: string) =>
    markets.find((m) => m.asset.toLowerCase() === asset.toLowerCase());

  return (
    <div className="space-y-6">
      <DeploymentNotice />
      <GuardNotice venue="core" />
      {walletConnected && (
        <div className="flex justify-end">
          <FreshnessStamp stamp={stamp} label="Positions" />
        </div>
      )}
      {/* ─── Stats Grid ─── */}
      {walletConnected && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in">
          {/* Total Supplied */}
          <div className="technical-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim">
                Total Supplied
              </span>
              <div className="p-2 bg-accent/10 rounded-lg">
                <ArrowUpRight size={14} className="text-accent" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-36" />
            ) : (
              <>
                <div className="text-2xl font-mono font-bold glow-text">
                  {formatUsd(userTotalSupplied)}
                </div>
                <div className="text-[10px] text-text-dim font-mono mt-1">Earning interest</div>
              </>
            )}
          </div>

          {/* Total Borrowed */}
          <div className="technical-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim">
                Total Borrowed
              </span>
              <div className="p-2 bg-accent/10 rounded-lg">
                <ArrowDownLeft size={14} className="text-accent" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-36" />
            ) : (
              <>
                <div className="text-2xl font-mono font-bold glow-text">
                  {formatUsd(userTotalBorrowed)}
                </div>
                <div className="text-[10px] text-text-dim font-mono mt-1">
                  Limit: {formatUsd(borrowLimit)}
                </div>
              </>
            )}
          </div>

          {/* Net Worth */}
          <div className="technical-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim">
                Net Worth
              </span>
              <div className="p-2 bg-accent/10 rounded-lg">
                <TrendingUp size={14} className="text-accent" />
              </div>
            </div>
            {isLoading ? (
              <Skeleton className="h-8 w-36" />
            ) : (
              <>
                <div className={`text-2xl font-mono font-bold glow-text ${netWorth === undefined || netWorth >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {formatUsd(netWorth)}
                </div>
                <div className="text-[10px] text-text-dim font-mono mt-1">Supplied - Borrowed</div>
              </>
            )}
          </div>

          {/* Health Factor */}
          <div className="technical-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim">
                Health Factor
              </span>
              <div className="p-2 bg-accent/10 rounded-lg">
                <Shield size={14} className="text-accent" />
              </div>
            </div>
            {healthFactor === undefined ? (
              <div className="text-2xl font-mono font-bold text-muted-foreground">--</div>
            ) : (
              <>
                <div className={`text-2xl font-mono font-bold glow-text ${hfTextColor}`}>
                  {formatHealthFactor(healthFactor)}
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2.5">
                  <div
                    className={`h-full ${hfColor} rounded-full transition-all duration-500`}
                    style={{ width: `${hfPercent}%` }}
                  />
                </div>
                <div className="text-[10px] text-text-dim font-mono mt-1.5">
                  Liquidation at &lt; 1.0
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ─── Search Bar ─── */}
      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
          <input
            type="text"
            placeholder="Search assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-card border border-border pl-9 pr-3 py-2 text-xs font-mono text-foreground placeholder:text-text-dim focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>
      </div>

      {/* ─── Supply & Borrow Tables ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Supply Markets */}
        <div className="animate-in-delay-1">
          <div className="flex items-center gap-2 mb-4">
            <ArrowUpRight size={14} className="text-accent" />
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-accent">
              Supply Markets
            </span>
          </div>

          <div className="technical-border bg-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    Asset
                  </th>
                  <th className="text-left text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    Supplied
                  </th>
                  <th className="text-left text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    APY
                  </th>
                  <th className="text-center text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    Collateral
                  </th>
                  <th className="text-right text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <>
                    {[0, 1, 2].map((i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-4 py-4" colSpan={5}>
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))}
                  </>
                ) : (
                  filtered.map((m) => {
                    const mInfo = getMarketInfo(m.asset);
                    const pos = positions.find((p) => p.asset.toLowerCase() === m.asset.toLowerCase());
                    const supplied = pos?.supplied ?? 0n;
                    const suppliedUsd = usdValue(supplied, m.decimals, priceOf(m.asset));
                    const hasCollateral = isCollateralEnabled(m.asset);

                    return (
                      <tr
                        key={m.symbol}
                        className="border-b border-border/50 hover:bg-white/5 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link href={`/markets/${m.symbol.toLowerCase()}`} className="flex items-center gap-2.5">
                            <TokenIcon symbol={m.symbol} size={24} />
                            <div>
                              <div className="text-xs font-mono font-medium text-foreground">
                                {m.symbol}
                              </div>
                              <div className="text-[10px] text-text-dim">{m.name}</div>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-mono text-foreground">
                            {formatTokenAmount(pos?.supplied ?? 0n, m.decimals)}
                          </div>
                          <div className="text-[10px] text-text-dim font-mono">
                            {formatUsd(suppliedUsd)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-emerald-400 font-mono text-sm">
                            {mInfo ? formatPercent(mInfo.supplyRate) : "--"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setModal({ type: "collateral", market: m })}
                            className={`
                              relative inline-flex h-5 w-9 items-center rounded-full transition-colors
                              ${hasCollateral ? "bg-accent" : "bg-muted-foreground/30"}
                            `}
                          >
                            <span
                              className={`
                                inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                                ${hasCollateral ? "translate-x-[18px]" : "translate-x-[3px]"}
                              `}
                            />
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-1.5 justify-end">
                            <button
                              onClick={() => setModal({ type: "supply", market: m })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Supply
                            </button>
                            {supplied > 0n && (
                              <button
                                onClick={() => setModal({ type: "withdraw", market: m })}
                                className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                              >
                                Withdraw
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Borrow Markets */}
        <div className="animate-in-delay-2">
          <div className="flex items-center gap-2 mb-4">
            <ArrowDownLeft size={14} className="text-accent" />
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-accent">
              Borrow Markets
            </span>
          </div>

          <div className="technical-border bg-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    Asset
                  </th>
                  <th className="text-left text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    Borrowed
                  </th>
                  <th className="text-left text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    APY
                  </th>
                  <th className="text-right text-[10px] text-text-dim uppercase font-mono tracking-wider px-4 py-3">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <>
                    {[0, 1, 2].map((i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="px-4 py-4" colSpan={4}>
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))}
                  </>
                ) : (
                  filtered.map((m) => {
                    const mInfo = getMarketInfo(m.asset);
                    const pos = positions.find((p) => p.asset.toLowerCase() === m.asset.toLowerCase());
                    const borrowed = pos?.borrowed ?? 0n;
                    const borrowedUsd = usdValue(borrowed, m.decimals, priceOf(m.asset));

                    return (
                      <tr
                        key={m.symbol}
                        className="border-b border-border/50 hover:bg-white/5 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link href={`/markets/${m.symbol.toLowerCase()}`} className="flex items-center gap-2.5">
                            <TokenIcon symbol={m.symbol} size={24} />
                            <div>
                              <div className="text-xs font-mono font-medium text-foreground">
                                {m.symbol}
                              </div>
                              <div className="text-[10px] text-text-dim">{m.name}</div>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-mono text-foreground">
                            {formatTokenAmount(pos?.borrowed ?? 0n, m.decimals)}
                          </div>
                          <div className="text-[10px] text-text-dim font-mono">
                            {formatUsd(borrowedUsd)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-amber-400 font-mono text-sm">
                            {mInfo ? formatPercent(mInfo.borrowRate) : "--"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-1.5 justify-end">
                            <button
                              onClick={() => setModal({ type: "borrow", market: m })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Borrow
                            </button>
                            {borrowed > 0n && (
                              <button
                                onClick={() => setModal({ type: "repay", market: m })}
                                className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                              >
                                Repay
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── Modals ─── */}
      {modal?.type === "supply" && (
        <SupplyModal
          asset={modal.market.asset}
          symbol={modal.market.symbol}
          decimals={modal.market.decimals}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "borrow" && (
        <BorrowModal
          asset={modal.market.asset}
          symbol={modal.market.symbol}
          decimals={modal.market.decimals}
          onClose={() => setModal(null)}
        />
      )}
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
      {modal?.type === "collateral" && (
        <EnableCollateralModal
          asset={modal.market.asset}
          symbol={modal.market.symbol}
          currentlyEnabled={isCollateralEnabled(modal.market.asset)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
