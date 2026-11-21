"use client";

import { ArrowDownLeft, ArrowUpRight, Percent, TrendingUp, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { formatApy, formatUsd8 } from "@/lib/format";
import type { AccountTotals } from "@/lib/portfolio/combine";

interface Card {
  id: string;
  label: string;
  value: string;
  sub: string;
  icon: LucideIcon;
  tone?: string;
}

/**
 * Net worth, deposits, debt and net APY across the core pool and the isolated pairs, all from
 * `accountTotals()` (spec ui-usability-v1 §3.3). Shared by the dashboard and the portfolio, so
 * both pages show the same numbers. An unavailable total reads "—", never $0 (FE-07).
 */
export function AccountSummary({ totals, loading }: { totals: AccountTotals; loading: boolean }) {
  const negative = totals.netWorth !== undefined && totals.netWorth < 0n;
  const cards: Card[] = [
    {
      id: "net-worth",
      label: "Net Worth",
      value: formatUsd8(totals.netWorth),
      sub: "Deposits − debt (wallets excluded)",
      icon: TrendingUp,
      tone: negative ? "text-destructive-strong" : "text-success-strong",
    },
    {
      id: "deposits",
      label: "Total Deposits",
      value: formatUsd8(totals.deposits),
      sub: "Core + isolated deposits and collateral",
      icon: ArrowUpRight,
    },
    { id: "debt", label: "Total Debt", value: formatUsd8(totals.debt), sub: "Core + isolated debt", icon: ArrowDownLeft },
    { id: "net-apy", label: "Net APY", value: formatApy(totals.netApy), sub: "Earnings − interest, on net worth", icon: Percent },
  ];

  return (
    <section aria-label="Account summary" className="space-y-3 animate-in">
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
        {!loading && totals.incomplete && (
          <span className="text-[10px] font-mono text-warning-strong" data-testid="totals-incomplete">
            Isolated positions unavailable: a pair read failed, so the totals are not shown
          </span>
        )}
        <FreshnessStamp stamp={totals.stamp} label="Valuation" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(({ id, label, value, sub, icon: Icon, tone }) => (
          <div key={id} className="technical-border bg-card p-5 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim">{label}</span>
              <div className="p-2 bg-accent/10 rounded-lg">
                <Icon size={14} className="text-accent" />
              </div>
            </div>
            {loading ? (
              <Skeleton className="h-8 w-36" />
            ) : (
              <>
                <div className={`text-2xl font-mono font-bold glow-text truncate ${tone ?? ""}`} data-testid={`summary-${id}`}>
                  {value}
                </div>
                <div className="text-[10px] text-text-dim font-mono mt-1">{sub}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
