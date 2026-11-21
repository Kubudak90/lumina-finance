"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { FixedTokenIcon, PairIcons } from "@/components/overview/FixedTokenIcon";
import { formatApy, formatLiquidationPrice, formatTokenAmount, formatUsd8 } from "@/lib/format";
import { formatMaxLtvPercent, type HealthStatus } from "@/lib/risk";
import type { IsolatedBorrowRow, PositionRow } from "@/lib/overview";

type Address = `0x${string}`;

/** A row action; the page maps it to the existing modal and its current props. */
export type PositionAction =
  | { venue: "core"; type: "supply" | "withdraw" | "borrow" | "repay" | "collateral"; asset: Address }
  | { venue: "isolated"; type: "lend" | "withdraw" | "borrow" | "repay" | "addCollateral" | "removeCollateral"; pair: Address };

const STATUS_TEXT: Record<HealthStatus, string> = {
  safe: "text-emerald-400",
  warning: "text-amber-400",
  danger: "text-orange-400",
  liquidatable: "text-red-400",
  unavailable: "text-muted-foreground",
};

/** Data columns; the actions sit on their own line under each position (never clipped). */
const COLUMNS = 5;
const TH = "text-[10px] text-text-dim uppercase font-mono tracking-wider px-3 py-3 text-left";
const TD = "px-3 pt-3 pb-2 align-top";
const NUM = `${TD} font-mono text-xs whitespace-nowrap`;
const BTN =
  "px-2 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-accent";

const amountText = (amount: bigint | undefined, decimals: number, symbol: string) =>
  amount === undefined ? "unavailable" : `${formatTokenAmount(amount, decimals)} ${symbol}`;

function Action({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={BTN} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

function Position({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div>
        <div className="text-xs font-mono font-medium text-foreground whitespace-nowrap">{title}</div>
        <div className="text-[10px] text-text-dim font-mono whitespace-nowrap">{sub}</div>
      </div>
    </div>
  );
}

interface RowParts {
  cells: ReactNode;
  actions: ReactNode;
}

function isolatedBorrowParts(row: IsolatedBorrowRow, onAction: (a: PositionAction) => void): RowParts {
  const act = (type: Extract<PositionAction, { venue: "isolated" }>["type"]) => () => onAction({ venue: "isolated", type, pair: row.pair });
  const ltvText = row.maxLTV === undefined ? row.health.value : `${row.health.value} / ${formatMaxLtvPercent(row.maxLTV)}`;
  return {
    cells: (
      <>
        <td className={TD}>
          <Position
            icon={<PairIcons asset={row.assetSymbol} collateral={row.collateralSymbol} />}
            title={row.label}
            sub={row.hasDebt ? "Isolated · borrowed" : "Isolated · collateral only"}
          />
        </td>
        <td className={`${TD} font-mono text-xs whitespace-nowrap`}>
          <div data-testid="iso-debt-amount">Debt: {row.hasDebt ? amountText(row.debt.amount, row.assetDecimals, row.assetSymbol) : "none"}</div>
          <div className="text-text-dim" data-testid="iso-collateral-amount">
            Collateral: {amountText(row.collateral.amount, row.collateralDecimals, row.collateralSymbol)}
          </div>
        </td>
        <td className={NUM}>
          <div>{row.hasDebt ? formatUsd8(row.debt.usd) : "—"}</div>
          <div className="text-text-dim">{formatUsd8(row.collateral.usd)}</div>
        </td>
        <td className={`${NUM} text-amber-400`}>{row.hasDebt ? formatApy(row.debt.apy) : "—"}</td>
        <td className={`${TD} font-mono text-xs`}>
          <div className={STATUS_TEXT[row.health.status]}>
            LTV {ltvText} · {row.health.statusLabel}
          </div>
          <div className="text-text-dim">Liq.: {formatLiquidationPrice(row.liquidationPrice, "USDC")}</div>
          {row.stale && <div className="text-amber-400">Price data stale</div>}
        </td>
      </>
    ),
    actions: (
      <>
        <Action label="Borrow" onClick={act("borrow")} />
        {row.hasDebt && <Action label="Repay" onClick={act("repay")} />}
        <Action label="Add collateral" onClick={act("addCollateral")} />
        {row.collateral.amount > 0n && <Action label="Remove collateral" onClick={act("removeCollateral")} />}
      </>
    ),
  };
}

function rowParts(row: PositionRow, onAction: (a: PositionAction) => void): RowParts {
  switch (row.kind) {
    case "coreSupply": {
      const act = (type: "supply" | "withdraw" | "collateral") => () => onAction({ venue: "core", type, asset: row.asset });
      return {
        cells: (
          <>
            <td className={TD}>
              <Position icon={<FixedTokenIcon symbol={row.symbol} size={22} />} title={row.symbol} sub="Core · supplied" />
            </td>
            <td className={`${TD} font-mono text-xs whitespace-nowrap`}>{amountText(row.amount, row.decimals, row.symbol)}</td>
            <td className={NUM}>{formatUsd8(row.usd)}</td>
            <td className={`${NUM} text-emerald-400`}>{formatApy(row.apy)}</td>
            <td className={`${TD} font-mono text-xs`}>
              {row.collateralEnabled === undefined ? (
                <span className="text-muted-foreground">Collateral: unavailable</span>
              ) : row.collateralEnabled ? (
                <span className="text-emerald-400">Collateral: on</span>
              ) : (
                <span className="text-text-dim">Collateral: off</span>
              )}
            </td>
          </>
        ),
        actions: (
          <>
            <Action label="Supply" onClick={act("supply")} />
            <Action label="Withdraw" onClick={act("withdraw")} />
            <Action
              label={row.collateralEnabled ? "Disable collateral" : "Use as collateral"}
              onClick={act("collateral")}
              disabled={row.collateralEnabled === undefined}
            />
          </>
        ),
      };
    }
    case "coreBorrow": {
      const act = (type: "borrow" | "repay") => () => onAction({ venue: "core", type, asset: row.asset });
      return {
        cells: (
          <>
            <td className={TD}>
              <Position icon={<FixedTokenIcon symbol={row.symbol} size={22} />} title={row.symbol} sub="Core · borrowed" />
            </td>
            <td className={`${TD} font-mono text-xs whitespace-nowrap`}>{amountText(row.amount, row.decimals, row.symbol)}</td>
            <td className={NUM}>{formatUsd8(row.usd)}</td>
            <td className={`${NUM} text-amber-400`}>{formatApy(row.apy)}</td>
            <td className={`${TD} font-mono text-xs`}>
              <span className={STATUS_TEXT[row.health.status]} title="Shared by every core position">
                HF {row.health.value} · {row.health.statusLabel}
              </span>
            </td>
          </>
        ),
        actions: (
          <>
            <Action label="Borrow" onClick={act("borrow")} />
            <Action label="Repay" onClick={act("repay")} />
          </>
        ),
      };
    }
    case "isolatedLend": {
      const act = (type: "lend" | "withdraw") => () => onAction({ venue: "isolated", type, pair: row.pair });
      return {
        cells: (
          <>
            <td className={TD}>
              <Position icon={<PairIcons asset={row.assetSymbol} collateral={row.collateralSymbol} />} title={row.label} sub="Isolated · lent" />
            </td>
            <td className={`${TD} font-mono text-xs whitespace-nowrap`}>{amountText(row.amount, row.assetDecimals, row.assetSymbol)}</td>
            <td className={NUM}>{formatUsd8(row.usd)}</td>
            <td className={`${NUM} text-emerald-400`}>{formatApy(row.apy)}</td>
            <td className={`${TD} font-mono text-xs text-text-dim`}>No liquidation risk</td>
          </>
        ),
        actions: (
          <>
            <Action label="Lend" onClick={act("lend")} />
            <Action label="Withdraw" onClick={act("withdraw")} />
          </>
        ),
      };
    }
    case "isolatedBorrow":
      return isolatedBorrowParts(row, onAction);
    case "unavailable":
      return {
        cells: (
          <>
            <td className={TD}>
              <Position icon={null} title={row.label} sub={row.venue === "core" ? "Core" : "Isolated"} />
            </td>
            <td colSpan={COLUMNS - 1} className={`${TD} text-xs text-amber-400`}>
              Position unavailable: the read failed
            </td>
          </>
        ),
        actions: null,
      };
  }
}

/**
 * "Your positions" (spec ui-usability-v1 §3.3): core and isolated rows in one table, with USD,
 * APY, risk and row actions. An isolated borrow / collateral row shows the debt and the collateral
 * on two lines, and stays visible when only collateral is left. Each position's actions sit on a
 * line of their own, so the table fits its card at 1024 px without clipping or scrolling.
 */
export function PositionsTable({
  rows,
  loading,
  onAction,
}: {
  rows: readonly PositionRow[];
  loading: boolean;
  onAction: (action: PositionAction) => void;
}) {
  return (
    <section aria-label="Your positions" className="animate-in-delay-1">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Your positions</span>
      </div>
      <div className="technical-border bg-card">
        {/* Fits at 1024 px; an unusually long value scrolls inside the card, never the page. */}
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50">
              <th className={TH}>Position</th>
              <th className={TH}>Amount</th>
              <th className={TH}>Value</th>
              <th className={TH}>APY</th>
              <th className={TH}>Risk</th>
            </tr>
          </thead>
          {/* One <tbody> per position: its data row, then its actions on a full-width line. */}
          {rows.map((row) => {
            const { cells, actions } = rowParts(row, onAction);
            return (
              <tbody
                key={row.key}
                className="border-b border-border/50 hover:bg-white/5 transition-colors"
                data-testid="position-row"
                data-kind={row.kind}
              >
                <tr>{cells}</tr>
                {actions && (
                  <tr>
                    <td colSpan={COLUMNS} className="px-3 pb-3 pt-0">
                      <div className="flex flex-wrap justify-end gap-1.5">{actions}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={COLUMNS} className="px-3 py-4">
                  <Skeleton className="h-8 w-full" />
                </td>
              </tr>
            </tbody>
          ) : rows.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={COLUMNS} className="h-20 px-3 text-center text-xs text-muted-foreground">
                  No positions yet. Supply or borrow in a market below, or lend on an isolated pair.
                </td>
              </tr>
            </tbody>
          ) : null}
        </table>
        </div>
      </div>
    </section>
  );
}
