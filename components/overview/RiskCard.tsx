"use client";

import { Shield } from "lucide-react";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { Skeleton } from "@/components/ui/skeleton";
import { formatLiquidationPrice } from "@/lib/format";
import { HEALTH_STATUS_LABEL } from "@/lib/risk";
import type { OverallStatus, RiskSummary } from "@/lib/overview";

const STATUS_TONE: Record<OverallStatus, string> = {
  safe: "bg-success-surface text-success-fg border-success-border",
  warning: "bg-warning-surface text-warning-fg border-warning-border",
  danger: "bg-danger-surface text-danger-fg border-danger-border",
  liquidatable: "bg-destructive-surface text-destructive-fg border-destructive-border",
  unavailable: "bg-overlay text-warning-fg border-warning-border",
  loading: "bg-overlay text-text-dim border-border",
};

export function overallStatusLabel(status: OverallStatus): string {
  return status === "loading" ? "Loading…" : HEALTH_STATUS_LABEL[status];
}

/**
 * Risk at a glance (spec ui-usability-v1 §3.3): the core health factor and its liquidation price,
 * the riskiest isolated position (liquidatable → unavailable → highest LTV / max), and one overall
 * status that is never "Safe" while any position is unknown or still loading.
 */
export function RiskCard({ risk }: { risk: RiskSummary }) {
  const { core, isolated, status } = risk;
  return (
    <section aria-label="Risk" className="technical-border bg-card p-5 animate-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-accent/10 rounded-lg">
            <Shield size={14} className="text-accent" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim">Risk</span>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border ${STATUS_TONE[status]}`}
          data-testid="overall-status"
        >
          Overall: {overallStatusLabel(status)}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="min-w-0 space-y-2" data-testid="risk-core">
          <div className="text-[10px] font-mono uppercase tracking-wider text-accent">Core pool</div>
          <HealthFactorBar healthFactor={core.healthFactor} />
          <div className="text-xs font-mono text-muted-foreground">
            Liquidation price: <span className="text-foreground">{formatLiquidationPrice(core.liquidationPrice, "USD")}</span>
          </div>
        </div>

        <div className="min-w-0 space-y-2" data-testid="risk-isolated">
          <div className="text-[10px] font-mono uppercase tracking-wider text-accent">
            Riskiest isolated position
            {isolated.kind === "position" && <span className="text-foreground normal-case tracking-normal"> · {isolated.row.label}</span>}
          </div>
          {isolated.kind === "loading" ? (
            <Skeleton className="h-12 w-full" data-testid="risk-isolated-loading" />
          ) : isolated.kind === "none" ? (
            <p className="text-xs text-muted-foreground">No isolated borrow or collateral positions.</p>
          ) : isolated.kind === "unknown" ? (
            <p className="text-xs text-warning-strong" data-testid="risk-isolated-unknown">
              {isolated.label}: position unavailable (the read failed), so its risk is unknown.
            </p>
          ) : (
            <>
              <HealthFactorBar variant="ltv" ltv={isolated.row.ltv} maxLTV={isolated.row.maxLTV} />
              <div className="text-xs font-mono text-muted-foreground">
                Liquidation price:{" "}
                <span className="text-foreground">{formatLiquidationPrice(isolated.row.liquidationPrice, "USDC")}</span>
              </div>
              {isolated.row.stale && <div className="text-[10px] font-mono text-warning-strong">Price data stale (borrows blocked)</div>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
