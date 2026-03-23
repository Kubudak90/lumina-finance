"use client";

import { useState } from "react";
import { TokenIcon } from "@/components/common/TokenIcon";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { useUserPosition } from "@/hooks/useUserPosition";
import { usePrices } from "@/hooks/usePrices";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { formatPercent, formatHealthFactor, formatTokenAmount } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { SupplyModal } from "@/components/actions/SupplyModal";
import { BorrowModal } from "@/components/actions/BorrowModal";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { RepayModal } from "@/components/actions/RepayModal";
import { EnableCollateralModal } from "@/components/actions/EnableCollateralModal";
import { EModeModal } from "@/components/actions/EModeModal";
import { useEMode } from "@/hooks/useEMode";
import { useUserCollateralStatus } from "@/hooks/useUserCollateralStatus";
import { MARKETS, type MarketConfig } from "@/lib/constants";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  Shield,
  Zap,
  Search,
} from "lucide-react";

function fmtUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 2 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

type ModalState =
  | { type: "supply" | "borrow" | "withdraw" | "repay" | "collateral"; market: MarketConfig }
  | { type: "emode" }
  | null;

export default function Dashboard() {
  const { markets, isLoading } = useAllMarkets();
  const { healthFactor } = useHealthFactor();
  const { positions } = useUserPosition();
  const { data: prices } = usePrices();
  const { isConnected: walletConnected } = useAccount();
  const { currentCategoryId: eModeCategoryId, categoryData: eModeCategoryData } = useEMode();
  const { isCollateralEnabled } = useUserCollateralStatus();
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);

  // Compute user totals
  const userTotalSupplied = positions.reduce((sum, p) => {
    const price = prices?.[p.symbol] ?? 0;
    return sum + Number(formatUnits(p.supplied, p.decimals)) * price;
  }, 0);

  const userTotalBorrowed = positions.reduce((sum, p) => {
    const price = prices?.[p.symbol] ?? 0;
    return sum + Number(formatUnits(p.borrowed, p.decimals)) * price;
  }, 0);

  // HF
  const isMaxHf = healthFactor === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const hfNum = healthFactor ? (isMaxHf ? 99 : Number(healthFactor) / 1e18) : 0;
  const hfPercent = Math.min((hfNum / 5) * 100, 100);
  const hfColor = hfNum >= 2 ? "bg-emerald-500" : hfNum >= 1.2 ? "bg-amber-500" : "bg-rose-500";
  const hfTextColor = hfNum >= 2 ? "text-emerald-400" : hfNum >= 1.2 ? "text-amber-400" : "text-rose-400";

  // Borrow limit (rough: 85% of collateral for USDC-like)
  const borrowLimit = userTotalSupplied * 0.85;

  // Net worth
  const netWorth = userTotalSupplied - userTotalBorrowed;

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
                  {fmtUsd(userTotalSupplied)}
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
                  {fmtUsd(userTotalBorrowed)}
                </div>
                <div className="text-[10px] text-text-dim font-mono mt-1">
                  Limit: {fmtUsd(borrowLimit)}
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
                <div className={`text-2xl font-mono font-bold glow-text ${netWorth >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {fmtUsd(netWorth)}
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModal({ type: "emode" })}
                  className="px-2 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                >
                  E-Mode
                </button>
                <div className="p-2 bg-accent/10 rounded-lg">
                  <Shield size={14} className="text-accent" />
                </div>
              </div>
            </div>
            {!healthFactor ? (
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

      {/* ─── E-Mode Indicator ─── */}
      {walletConnected && eModeCategoryId > 0 && eModeCategoryData && (
        <div className="technical-border bg-accent-dim/30 p-3 flex items-center gap-3 animate-in">
          <Zap size={14} className="text-accent shrink-0" />
          <span className="text-xs text-accent font-mono">
            E-Mode: {eModeCategoryData.label || "Stablecoins"} (Higher LTV)
          </span>
          <button
            onClick={() => setModal({ type: "emode" })}
            className="ml-auto px-3 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
          >
            Manage
          </button>
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
                    const price = prices?.[m.symbol] ?? 0;
                    const suppliedAmt = pos ? Number(formatUnits(pos.supplied, m.decimals)) : 0;
                    const suppliedUsd = suppliedAmt * price;
                    const hasCollateral = pos ? pos.collateral > 0n : false;

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
                            {fmtUsd(suppliedUsd)}
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
                          <button
                            onClick={() =>
                              setModal(
                                suppliedAmt > 0
                                  ? { type: "withdraw", market: m }
                                  : { type: "supply", market: m }
                              )
                            }
                            className="px-3 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                          >
                            {suppliedAmt > 0 ? "Withdraw" : "Supply"}
                          </button>
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
                    const price = prices?.[m.symbol] ?? 0;
                    const borrowedAmt = pos ? Number(formatUnits(pos.borrowed, m.decimals)) : 0;
                    const borrowedUsd = borrowedAmt * price;

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
                            {fmtUsd(borrowedUsd)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-emerald-400 font-mono text-sm">
                            {mInfo ? formatPercent(mInfo.borrowRate) : "--"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() =>
                              setModal(
                                borrowedAmt > 0
                                  ? { type: "repay", market: m }
                                  : { type: "borrow", market: m }
                              )
                            }
                            className="px-3 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                          >
                            {borrowedAmt > 0 ? "Repay" : "Borrow"}
                          </button>
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
          decimals={modal.market.decimals}
          currentlyEnabled={isCollateralEnabled(modal.market.asset)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "emode" && (
        <EModeModal onClose={() => setModal(null)} />
      )}
    </div>
  );
}
