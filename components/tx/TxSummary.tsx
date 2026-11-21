"use client";

import type { ReactNode } from "react";
import type Decimal from "decimal.js";
import {
  formatHealth,
  formatMaxLtvPercent,
  type CorePreview,
  type CoreRisk,
  type HealthStatus,
  type IsolatedMarketSides,
  type IsolatedPreview,
  type IsolatedRisk,
  type Unavailable,
  type UnavailableReason,
} from "@/lib/risk";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import type { BlockStamp } from "@/hooks/useBlockStamp";
import { UNAVAILABLE, formatBorrowLimit, formatLiquidationPrice, formatRate, formatToken } from "./format";
import type { AfterReadStatus } from "./reads";

/**
 * `TxSummary` (ui-usability-v1 §3.2): before → after of the action, in one of three profiles.
 * - (a) borrower risk: core HF / borrow limit / liquidation price / APY, or isolated LTV /
 *   liquidation price / collateral / debt / APY. The gauge shows the AFTER value.
 * - (b) lender: lent balance and lend APY.
 * - (c) liquidation: the debt repaid and the borrower's remaining debt and collateral. Never the
 *   liquidator's own HF or LTV.
 * A missing input reads "unavailable", never 0 (FE-07).
 */

type Profile = "core" | "isolated" | "lender" | "liquidation";

function Frame({ profile, title, children }: { profile: Profile; title?: string; children: ReactNode }) {
  return (
    <div className="technical-border bg-background p-3 space-y-2" data-testid="tx-summary" data-profile={profile}>
      {title && <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{title}</p>}
      {children}
    </div>
  );
}

/** One "label: before → after" line; `after` omitted for a single value. */
export function SummaryRow({ label, before, after, tone }: { label: string; before: string; after?: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm" data-row={label}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-right">
        {after === undefined ? (
          <span className={tone}>{before}</span>
        ) : (
          <>
            <span>{before}</span>
            <span className="text-muted-foreground"> &rarr; </span>
            <span className={tone}>{after}</span>
          </>
        )}
      </span>
    </div>
  );
}

const STATUS_TONE: Record<HealthStatus, string> = {
  safe: "text-emerald-400",
  warning: "text-amber-400",
  danger: "text-orange-400",
  liquidatable: "text-red-400",
  unavailable: "text-muted-foreground",
};

const UNAVAILABLE_WHY: Record<UnavailableReason, string> = {
  emode: "Your account uses an eMode category; its risk figures cannot be previewed here.",
  "unknown-reserve": "Your account holds a reserve outside this app's market set; its risk figures cannot be previewed here.",
  "missing-input": "Some of the data behind this preview is loading or could not be read.",
};

/** An invalid amount's preview is still shown; it says "clamped" only when the maths clamped it. */
function InvalidNote({ text, clamped }: { text: string | null | undefined; clamped: boolean }) {
  if (!text) return null;
  return (
    <p className="text-xs text-destructive" data-testid="tx-summary-invalid">
      Preview of an invalid amount: {text}.{clamped ? " The preview clamps it to what the action can use." : ""}
    </p>
  );
}

/** The warning that goes with an after-state status (formatHealth thresholds). */
function RiskWarning({ status, venue }: { status: HealthStatus; venue: "core" | "isolated" }) {
  if (status === "liquidatable") {
    return (
      <p className="text-xs text-red-500 font-medium">
        {venue === "core"
          ? "After this the health factor is below 1.0: the position can be liquidated."
          : "After this the LTV is above the pair's max LTV: the position can be liquidated."}
      </p>
    );
  }
  if (status === "danger") {
    return (
      <p className="text-xs text-orange-400 font-medium">
        {venue === "core" ? "Health factor below 1.2 after this: high liquidation risk." : "LTV at 90% or more of the max after this: high liquidation risk."}
      </p>
    );
  }
  if (status === "warning") {
    return (
      <p className="text-xs text-amber-400 font-medium">
        {venue === "core" ? "Health factor below 1.5 after this: watch the position." : "LTV at 80% or more of the max after this: watch the position."}
      </p>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// (a) core
// ---------------------------------------------------------------------------------------------

const coreHf = (r: CoreRisk | Unavailable) => (r.available ? r.healthFactor : undefined);
const coreHfText = (r: CoreRisk | Unavailable) => (r.available ? formatHealth({ kind: "hf", healthFactor: r.healthFactor }).value : UNAVAILABLE);
const coreLimitText = (r: CoreRisk | Unavailable) => (r.available ? formatBorrowLimit(r.borrowLimitUsed) : UNAVAILABLE);
const coreLiqText = (r: CoreRisk | Unavailable) => (r.available ? formatLiquidationPrice(r.liquidationPrice, "usd") : UNAVAILABLE);

export function CoreRiskSummary({
  preview,
  apy,
  apyLabel,
  invalid,
  stamp,
}: {
  preview: CorePreview;
  apy: Decimal | undefined;
  apyLabel: string;
  invalid?: string | null;
  stamp: BlockStamp | undefined;
}) {
  const after = preview.after;
  const afterHealth = formatHealth({ kind: "hf", healthFactor: coreHf(after) });
  const why = !after.available ? after.reason : !preview.before.available ? preview.before.reason : null;
  return (
    <Frame profile="core" title="Before → after">
      <SummaryRow label="Health factor" before={coreHfText(preview.before)} after={coreHfText(after)} tone={STATUS_TONE[afterHealth.status]} />
      <HealthFactorBar healthFactor={coreHf(after)} />
      <SummaryRow label="Borrow limit used" before={coreLimitText(preview.before)} after={coreLimitText(after)} />
      <SummaryRow label="Liquidation price" before={coreLiqText(preview.before)} after={coreLiqText(after)} />
      <SummaryRow label={apyLabel} before={formatRate(apy)} />
      {why && <p className="text-xs text-muted-foreground">{UNAVAILABLE_WHY[why]}</p>}
      <RiskWarning status={afterHealth.status} venue="core" />
      <InvalidNote text={invalid ?? (preview.invalid ? "more than the action can use" : null)} clamped={preview.clamped} />
      <FreshnessStamp stamp={stamp} label="Position" />
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
// (a) isolated
// ---------------------------------------------------------------------------------------------

function ltvText(r: IsolatedRisk): string {
  if (r.ltv.kind === "unavailable") return UNAVAILABLE;
  return formatHealth({ kind: "ltv", ltv: r.ltv, maxLTV: r.maxLTV }).value;
}

export function IsolatedRiskSummary({
  preview,
  sides,
  apy,
  apyLabel,
  invalid,
  stamp,
}: {
  preview: IsolatedPreview;
  sides: IsolatedMarketSides;
  apy: Decimal | undefined;
  apyLabel: string;
  invalid?: string | null;
  stamp: BlockStamp | undefined;
}) {
  const { before, after } = preview;
  const afterHealth = formatHealth({ kind: "ltv", ltv: after.ltv, maxLTV: after.maxLTV });
  const max = after.maxLTV === undefined ? UNAVAILABLE : formatMaxLtvPercent(after.maxLTV);
  return (
    <Frame profile="isolated" title="Before → after">
      <SummaryRow label={`LTV (max ${max})`} before={ltvText(before)} after={ltvText(after)} tone={STATUS_TONE[afterHealth.status]} />
      <HealthFactorBar variant="ltv" ltv={after.ltv} maxLTV={after.maxLTV} />
      {after.stale && <p className="text-xs text-amber-400" data-testid="price-stale">Price data stale: the pair oracle flags its price as bad.</p>}
      <SummaryRow
        label="Liquidation price"
        before={formatLiquidationPrice(before.liquidationPrice, "usdc")}
        after={formatLiquidationPrice(after.liquidationPrice, "usdc")}
      />
      <SummaryRow
        label="Collateral"
        before={formatToken(before.collateral, sides.collateralDecimals, sides.collateralSymbol)}
        after={formatToken(after.collateral, sides.collateralDecimals, sides.collateralSymbol)}
      />
      <SummaryRow
        label="Debt"
        before={formatToken(before.debt, sides.assetDecimals, sides.assetSymbol)}
        after={formatToken(after.debt, sides.assetDecimals, sides.assetSymbol)}
      />
      <SummaryRow label={apyLabel} before={formatRate(apy)} />
      <RiskWarning status={afterHealth.status} venue="isolated" />
      {/* lib/risk clamps every isolated over-amount it flags (repay over the debt, remove over the collateral). */}
      <InvalidNote text={invalid ?? (preview.invalid ? "more than the position holds" : null)} clamped={preview.invalid} />
      <FreshnessStamp stamp={stamp} label="Position" />
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
// (b) lender
// ---------------------------------------------------------------------------------------------

export function LenderSummary({
  before,
  after,
  symbol,
  decimals,
  apy,
  invalid,
  clamped = false,
}: {
  before: bigint | undefined;
  after: bigint | undefined;
  symbol: string;
  decimals: number;
  apy: Decimal | undefined;
  invalid?: string | null;
  /** `after` was clamped (a withdrawal over the lent balance shows 0). */
  clamped?: boolean;
}) {
  return (
    <Frame profile="lender" title="Before → after">
      <SummaryRow label="Lent balance" before={formatToken(before, decimals, symbol)} after={formatToken(after, decimals, symbol)} />
      <SummaryRow label="Lend APY" before={formatRate(apy)} />
      <InvalidNote text={invalid} clamped={clamped} />
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
// (c) liquidation
// ---------------------------------------------------------------------------------------------

export interface LiquidationFigures {
  /** Debt repaid by this liquidation (estimate for a share-based one). */
  repaid: bigint | undefined;
  debtBefore: bigint | undefined;
  debtAfter: bigint | undefined;
  collateralBefore: bigint | undefined;
  collateralAfter: bigint | undefined;
  debtSymbol: string;
  debtDecimals: number;
  collateralSymbol: string;
  collateralDecimals: number;
}

export function LiquidationSummary({ figures, note }: { figures: LiquidationFigures; note?: ReactNode }) {
  const f = figures;
  return (
    <Frame profile="liquidation" title="Borrower before → after (estimate)">
      <SummaryRow label="Debt repaid" before={formatToken(f.repaid, f.debtDecimals, f.debtSymbol)} />
      <SummaryRow
        label="Borrower debt"
        before={formatToken(f.debtBefore, f.debtDecimals, f.debtSymbol)}
        after={formatToken(f.debtAfter, f.debtDecimals, f.debtSymbol)}
      />
      <SummaryRow
        label="Borrower collateral"
        before={formatToken(f.collateralBefore, f.collateralDecimals, f.collateralSymbol)}
        after={formatToken(f.collateralAfter, f.collateralDecimals, f.collateralSymbol)}
      />
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
// Success screen: the after-state, read at or after the receipt block
// ---------------------------------------------------------------------------------------------

/** "reading…" until a read at a block ≥ the receipt block arrives; "unavailable" if it failed. */
export function AfterState({
  status,
  stamp,
  rows,
  title = "After this transaction",
}: {
  status: AfterReadStatus;
  stamp: BlockStamp | undefined;
  rows: { label: string; value: string }[];
  title?: string;
}) {
  return (
    <div className="technical-border bg-background p-3 space-y-1.5 text-left" data-testid="after-state" data-status={status}>
      <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{title}</p>
      {status === "ready" ? (
        <>
          {rows.map((r) => (
            <SummaryRow key={r.label} label={r.label} before={r.value} />
          ))}
          <FreshnessStamp stamp={stamp} />
        </>
      ) : (
        <p className="text-sm font-mono text-muted-foreground">{status === "reading" ? "reading…" : UNAVAILABLE}</p>
      )}
    </div>
  );
}

/** After-state rows of a core account (HF, borrow limit used, liquidation price). */
export function coreAfterRows(r: CoreRisk | Unavailable): { label: string; value: string }[] {
  return [
    { label: "Health factor", value: coreHfText(r) },
    { label: "Borrow limit used", value: coreLimitText(r) },
    { label: "Liquidation price", value: coreLiqText(r) },
  ];
}

/** After-state rows of an isolated position (LTV, liquidation price, collateral, debt). */
export function isolatedAfterRows(r: IsolatedRisk, sides: IsolatedMarketSides): { label: string; value: string }[] {
  const max = r.maxLTV === undefined ? UNAVAILABLE : formatMaxLtvPercent(r.maxLTV);
  return [
    { label: `LTV (max ${max})`, value: ltvText(r) },
    { label: "Liquidation price", value: formatLiquidationPrice(r.liquidationPrice, "usdc") },
    { label: "Collateral", value: formatToken(r.collateral, sides.collateralDecimals, sides.collateralSymbol) },
    { label: "Debt", value: formatToken(r.debt, sides.assetDecimals, sides.assetSymbol) },
  ];
}
