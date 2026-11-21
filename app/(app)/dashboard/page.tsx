"use client";

import { useState } from "react";
import { TokenIcon } from "@/components/common/TokenIcon";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { useAccountOverview } from "@/hooks/useAccountOverview";
import { formatApy, formatTokenAmount } from "@/lib/format";
import { formatUsd, usdValue } from "@/lib/prices";
import { coreApy } from "@/lib/risk";
import { Skeleton } from "@/components/ui/skeleton";
import { SupplyModal } from "@/components/actions/SupplyModal";
import { BorrowModal } from "@/components/actions/BorrowModal";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { RepayModal } from "@/components/actions/RepayModal";
import { EnableCollateralModal } from "@/components/actions/EnableCollateralModal";
import { IsolatedLendModal } from "@/components/actions/IsolatedLendModal";
import { IsolatedWithdrawModal } from "@/components/actions/IsolatedWithdrawModal";
import { IsolatedBorrowModal } from "@/components/actions/IsolatedBorrowModal";
import { IsolatedRepayModal } from "@/components/actions/IsolatedRepayModal";
import { IsolatedAddCollateralModal } from "@/components/actions/IsolatedAddCollateralModal";
import { IsolatedRemoveCollateralModal } from "@/components/actions/IsolatedRemoveCollateralModal";
import { GuardNotice } from "@/components/common/GuardNotice";
import { DeploymentNotice } from "@/components/common/DeploymentNotice";
import { AccountSummary } from "@/components/overview/AccountSummary";
import { RiskCard } from "@/components/overview/RiskCard";
import { PositionsTable, type PositionAction } from "@/components/overview/PositionsTable";
import { MARKETS, getMarketByAsset, type MarketConfig } from "@/lib/constants";
import Link from "next/link";
import { ArrowUpRight, ArrowDownLeft, Search } from "lucide-react";

type ModalState =
  | { type: "supply" | "borrow" | "withdraw" | "repay" | "collateral"; market: MarketConfig }
  | {
      type: "isoLend" | "isoWithdraw" | "isoBorrow" | "isoRepay" | "isoAddCollateral" | "isoRemoveCollateral";
      pair: `0x${string}`;
    }
  | null;

const ISOLATED_MODAL = {
  lend: "isoLend",
  withdraw: "isoWithdraw",
  borrow: "isoBorrow",
  repay: "isoRepay",
  addCollateral: "isoAddCollateral",
  removeCollateral: "isoRemoveCollateral",
} as const;

export default function Dashboard() {
  const { markets, isLoading } = useAllMarkets();
  const { positions } = useUserPosition();
  const { priceOf } = useOraclePrices();
  // Core + isolated: totals from accountTotals(), the position rows and the risk card (spec §3.3).
  const overview = useAccountOverview();
  const walletConnected = overview.connected;
  const isCollateralEnabled = (asset: string) =>
    positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase())?.collateralEnabled ?? false;
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<ModalState>(null);

  // "Your positions" row actions open the existing modals with their current props.
  const onAction = (action: PositionAction) => {
    if (action.venue === "isolated") {
      setModal({ type: ISOLATED_MODAL[action.type], pair: action.pair });
      return;
    }
    const market = getMarketByAsset(action.asset);
    if (market) setModal({ type: action.type, market });
  };

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
      {/* ─── Account: summary, risk, positions (core + isolated) ─── */}
      {walletConnected && (
        <>
          <AccountSummary totals={overview.totals} loading={overview.loading} />
          <RiskCard risk={overview.risk} />
          <PositionsTable rows={overview.rows} loading={overview.loading} onAction={onAction} />
        </>
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
      {/* Side by side only from 2xl: at 1280 px each half is too narrow for its actions. */}
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
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
                    const supplied = pos?.supplied;
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
                            {supplied === undefined ? "—" : formatTokenAmount(supplied, m.decimals)}
                          </div>
                          <div className="text-[10px] text-text-dim font-mono">
                            {formatUsd(suppliedUsd)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-emerald-400 font-mono text-sm">
                            {mInfo ? formatApy(coreApy(mInfo.supplyRate)) : "—"}
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
                          <div className="flex gap-1.5 justify-end flex-wrap">
                            <button
                              onClick={() => setModal({ type: "supply", market: m })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Supply
                            </button>
                            {supplied !== undefined && supplied > 0n && (
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
                    const borrowed = pos?.borrowed;
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
                            {borrowed === undefined ? "—" : formatTokenAmount(borrowed, m.decimals)}
                          </div>
                          <div className="text-[10px] text-text-dim font-mono">
                            {formatUsd(borrowedUsd)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-amber-400 font-mono text-sm">
                            {mInfo ? formatApy(coreApy(mInfo.borrowRate)) : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex gap-1.5 justify-end flex-wrap">
                            <button
                              onClick={() => setModal({ type: "borrow", market: m })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Borrow
                            </button>
                            {borrowed !== undefined && borrowed > 0n && (
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
      {modal?.type === "isoLend" && <IsolatedLendModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "isoWithdraw" && <IsolatedWithdrawModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "isoBorrow" && <IsolatedBorrowModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "isoRepay" && <IsolatedRepayModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "isoAddCollateral" && <IsolatedAddCollateralModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "isoRemoveCollateral" && <IsolatedRemoveCollateralModal pair={modal.pair} onClose={() => setModal(null)} />}
    </div>
  );
}
