/**
 * The account overview (ui-usability-v1 spec §3.3), pure: the totals (from `accountTotals()`, the
 * one definition the dashboard and the portfolio share), the "Your positions" row model, and the
 * risk card with its riskiest-isolated-position priority.
 *
 * FE-07: a missing read is "unavailable", never 0, and the overall status is never "Safe" while
 * any position's risk is unknown (a failed or loading pair snapshot, missing core data).
 */
import type Decimal from "decimal.js";
import { accountTotals, type AccountTotals } from "./portfolio/combine";
import { baseValue, isolatedCollateralBase8 } from "./prices";
import {
  aprToApy,
  buildCoreSnapshot,
  coreApy,
  coreRisk,
  formatHealth,
  isolatedLiquidationPrice,
  isolatedLtvOf,
  type HealthDisplay,
  type HealthStatus,
  type IsolatedLtvResult,
  type LiquidationPrice,
} from "./risk";
import type { BlockStamp } from "./valuation";

type Address = `0x${string}`;

// ---------------------------------------------------------------------------------------------
// Inputs (the shapes the existing hooks already return)
// ---------------------------------------------------------------------------------------------

export interface OverviewCorePosition {
  asset: Address;
  symbol: string;
  decimals: number;
  /** aToken balance; undefined = unavailable. */
  supplied: bigint | undefined;
  /** Variable debt; undefined = unavailable. */
  borrowed: bigint | undefined;
  collateralEnabled: boolean | undefined;
}

export interface OverviewCoreMarket {
  asset: string;
  /** Aave ray rates (APR). */
  supplyRate: bigint | undefined;
  borrowRate: bigint | undefined;
  /** Reserve config (bps). */
  config: { ltv: number; liquidationThreshold: number } | undefined;
}

export interface OverviewIsolatedPosition {
  pair: Address | null;
  asset: string;
  assetSymbol: string;
  collateralSymbol: string;
  assetDecimals: number;
  collateralDecimals: number;
  suppliedShares: bigint;
  borrowedShares: bigint;
  collateralAmount: bigint;
  suppliedAssets: bigint | undefined;
  borrowedAssets: bigint | undefined;
  maxLTV: bigint | undefined;
  /** R: collateral per asset × 1e18 (the dual oracle's priceHigh). */
  exchangeRate: bigint | undefined;
  oracleBadData: boolean | undefined;
  /** Pair APRs (fractions); undefined = unavailable. */
  lendApr: Decimal | undefined;
  borrowApr: Decimal | undefined;
}

export interface OverviewInput {
  core: {
    positions: readonly OverviewCorePosition[];
    /** On-chain getUserAccountData().healthFactor: the HF the overview displays (spec §3.1). */
    healthFactor: bigint | undefined;
    /** Pool.getUserEMode(user). */
    eMode: bigint | undefined;
    stamp: BlockStamp | undefined;
    loading: boolean;
  };
  markets: readonly OverviewCoreMarket[];
  /** AaveOracle price (8 decimals) by asset (FE-06). */
  priceOf: (asset: string) => bigint | undefined;
  pricesStamp: BlockStamp | undefined;
  isolated: {
    positions: readonly OverviewIsolatedPosition[];
    /** Deployed pairs (lowercase) whose snapshot failed or is loading. */
    unknownPairs: readonly string[];
    incomplete: boolean;
    loading: boolean;
    stamps: { snapshots: BlockStamp | undefined; conversions: BlockStamp | undefined; pairs: BlockStamp | undefined };
  };
  /** "USDC/WETH" for a pair address (lowercase). */
  pairLabel: (pair: string) => string;
  /** Any input still loading (positions, isolated reads, markets, prices). */
  loading: boolean;
}

// ---------------------------------------------------------------------------------------------
// "Your positions" rows (spec §3.3 row model)
// ---------------------------------------------------------------------------------------------

/** USD in base currency (8 decimals); undefined = unavailable. */
export type Usd8 = bigint | undefined;

export interface CoreSupplyRow {
  kind: "coreSupply";
  key: string;
  asset: Address;
  symbol: string;
  decimals: number;
  amount: bigint;
  usd: Usd8;
  apy: Decimal | undefined;
  collateralEnabled: boolean | undefined;
}

export interface CoreBorrowRow {
  kind: "coreBorrow";
  key: string;
  asset: Address;
  symbol: string;
  decimals: number;
  amount: bigint;
  usd: Usd8;
  apy: Decimal | undefined;
  /** The account's shared (on-chain) health factor. */
  health: HealthDisplay;
}

export interface IsolatedLendRow {
  kind: "isolatedLend";
  key: string;
  pair: Address;
  label: string;
  assetSymbol: string;
  collateralSymbol: string;
  assetDecimals: number;
  /** Lent assets; undefined when the share conversion failed. */
  amount: bigint | undefined;
  usd: Usd8;
  apy: Decimal | undefined;
}

export interface IsolatedBorrowRow {
  kind: "isolatedBorrow";
  key: string;
  pair: Address;
  label: string;
  assetSymbol: string;
  collateralSymbol: string;
  assetDecimals: number;
  collateralDecimals: number;
  hasDebt: boolean;
  debt: { amount: bigint | undefined; usd: Usd8; apy: Decimal | undefined };
  /** Posted collateral earns nothing: no APY. */
  collateral: { amount: bigint; usd: Usd8 };
  ltv: IsolatedLtvResult;
  maxLTV: bigint | undefined;
  health: HealthDisplay;
  liquidationPrice: LiquidationPrice;
  /** The pair oracle flags bad data: "price data stale" (the LTV is still shown). */
  stale: boolean;
}

export interface UnavailableRow {
  kind: "unavailable";
  key: string;
  venue: "core" | "isolated";
  label: string;
}

export type PositionRow = CoreSupplyRow | CoreBorrowRow | IsolatedLendRow | IsolatedBorrowRow | UnavailableRow;

const usd8 = (amount: bigint | undefined, decimals: number, price: bigint | undefined): Usd8 =>
  amount === undefined ? undefined : amount === 0n ? 0n : price === undefined || price <= 0n ? undefined : baseValue(amount, decimals, price);

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function isolatedBorrowRow(p: OverviewIsolatedPosition & { pair: Address }, label: string, assetPrice: bigint | undefined): IsolatedBorrowRow {
  const debt = p.borrowedAssets;
  const collateralUsd =
    p.collateralAmount === 0n
      ? 0n
      : p.exchangeRate === undefined || p.exchangeRate <= 0n || assetPrice === undefined || assetPrice <= 0n
        ? undefined
        : isolatedCollateralBase8(p.collateralAmount, p.exchangeRate, p.assetDecimals, assetPrice);
  const ltv = isolatedLtvOf({ debt, collateral: p.collateralAmount, maxLTV: p.maxLTV, exchangeRate: p.exchangeRate });
  return {
    kind: "isolatedBorrow",
    key: `iso-borrow-${p.pair.toLowerCase()}`,
    pair: p.pair,
    label,
    assetSymbol: p.assetSymbol,
    collateralSymbol: p.collateralSymbol,
    assetDecimals: p.assetDecimals,
    collateralDecimals: p.collateralDecimals,
    hasDebt: p.borrowedShares > 0n,
    debt: { amount: debt, usd: usd8(debt, p.assetDecimals, assetPrice), apy: p.borrowApr && aprToApy(p.borrowApr) },
    collateral: { amount: p.collateralAmount, usd: collateralUsd },
    ltv,
    maxLTV: p.maxLTV,
    health: formatHealth({ kind: "ltv", ltv, maxLTV: p.maxLTV }),
    liquidationPrice: isolatedLiquidationPrice(
      { debt, collateral: p.collateralAmount, maxLTV: p.maxLTV },
      {
        assetSymbol: p.assetSymbol,
        collateralSymbol: p.collateralSymbol,
        assetDecimals: p.assetDecimals,
        collateralDecimals: p.collateralDecimals,
      },
    ),
    stale: p.oracleBadData === true,
  };
}

/**
 * One row per core asset with a balance (supply) or debt (borrow), per pair with lent shares
 * (lend), and per pair with borrowed shares or posted collateral (borrow / collateral, including a
 * collateral-only position). A read that failed gives an "unavailable" row, never a missing one.
 */
export function positionRows(input: Pick<OverviewInput, "core" | "markets" | "priceOf" | "isolated" | "pairLabel">): PositionRow[] {
  const { core, markets, priceOf, isolated, pairLabel } = input;
  const marketOf = (asset: string) => markets.find((m) => sameAddress(m.asset, asset));
  const shared = formatHealth({ kind: "hf", healthFactor: core.healthFactor });
  const rows: PositionRow[] = [];

  for (const p of core.positions) {
    const price = priceOf(p.asset);
    const market = marketOf(p.asset);
    if (p.supplied !== undefined && p.supplied > 0n) {
      rows.push({
        kind: "coreSupply",
        key: `core-supply-${p.asset.toLowerCase()}`,
        asset: p.asset,
        symbol: p.symbol,
        decimals: p.decimals,
        amount: p.supplied,
        usd: usd8(p.supplied, p.decimals, price),
        apy: coreApy(market?.supplyRate),
        collateralEnabled: p.collateralEnabled,
      });
    }
  }
  for (const p of core.positions) {
    const price = priceOf(p.asset);
    const market = marketOf(p.asset);
    if (p.borrowed !== undefined && p.borrowed > 0n) {
      rows.push({
        kind: "coreBorrow",
        key: `core-borrow-${p.asset.toLowerCase()}`,
        asset: p.asset,
        symbol: p.symbol,
        decimals: p.decimals,
        amount: p.borrowed,
        usd: usd8(p.borrowed, p.decimals, price),
        apy: coreApy(market?.borrowRate),
        health: shared,
      });
    }
  }
  if (!core.loading) {
    for (const p of core.positions) {
      if (p.supplied === undefined || p.borrowed === undefined) {
        rows.push({ kind: "unavailable", key: `core-unknown-${p.asset.toLowerCase()}`, venue: "core", label: p.symbol });
      }
    }
  }

  for (const p of isolated.positions) {
    if (p.pair === null) continue;
    const label = pairLabel(p.pair.toLowerCase());
    const price = priceOf(p.asset);
    if (p.suppliedShares > 0n) {
      rows.push({
        kind: "isolatedLend",
        key: `iso-lend-${p.pair.toLowerCase()}`,
        pair: p.pair,
        label,
        assetSymbol: p.assetSymbol,
        collateralSymbol: p.collateralSymbol,
        assetDecimals: p.assetDecimals,
        amount: p.suppliedAssets,
        usd: usd8(p.suppliedAssets, p.assetDecimals, price),
        apy: p.lendApr && aprToApy(p.lendApr),
      });
    }
    if (p.borrowedShares > 0n || p.collateralAmount > 0n) {
      rows.push(isolatedBorrowRow({ ...p, pair: p.pair }, label, price));
    }
  }
  for (const pair of isolated.unknownPairs) {
    rows.push({ kind: "unavailable", key: `iso-unknown-${pair}`, venue: "isolated", label: pairLabel(pair) });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Risk card (spec §3.3, r1 #14.1, r2 table #14)
// ---------------------------------------------------------------------------------------------

/** Worst first. An unknown position outranks a known Danger: its risk could be anything. */
const SEVERITY: readonly HealthStatus[] = ["liquidatable", "unavailable", "danger", "warning", "safe"];

export function worstStatus(statuses: readonly HealthStatus[]): HealthStatus {
  let worst = SEVERITY.length - 1;
  for (const s of statuses) worst = Math.min(worst, SEVERITY.indexOf(s));
  return SEVERITY[worst];
}

export interface CoreRiskSummary {
  /** On-chain getUserAccountData().healthFactor (what the card displays). */
  healthFactor: bigint | undefined;
  health: HealthDisplay;
  /** From the per-reserve account data (lib/risk), "unavailable" when that is. */
  liquidationPrice: LiquidationPrice;
  /** Status for the overall roll-up: "unavailable" while the HF or the core account data is. */
  status: HealthStatus;
}

export type IsolatedRiskPick =
  | { kind: "none" }
  /** A pair whose snapshot failed (or is loading): whether it has debt is unknown. */
  | { kind: "unknown"; pair: string; label: string }
  | { kind: "position"; row: IsolatedBorrowRow; priority: "liquidatable" | "unavailable" | "highest" };

/**
 * The riskiest isolated position, in priority order: (1) any liquidatable position (debt with zero
 * collateral or maxLTV, or LTV > max); (2) any position whose data is unavailable, a pair in
 * `unknownPairs` first; (3) the highest ltv/maxLTV, compared by bigint cross-multiplication.
 */
export function riskiestIsolated(
  rows: readonly PositionRow[],
  unknownPairs: readonly string[],
  pairLabel: (pair: string) => string,
): IsolatedRiskPick {
  const candidates = rows.filter((r): r is IsolatedBorrowRow => r.kind === "isolatedBorrow");
  const liquidatable = candidates.find((r) => r.health.status === "liquidatable");
  if (liquidatable) return { kind: "position", row: liquidatable, priority: "liquidatable" };
  if (unknownPairs.length > 0) return { kind: "unknown", pair: unknownPairs[0], label: pairLabel(unknownPairs[0]) };
  const unavailable = candidates.find((r) => r.health.status === "unavailable");
  if (unavailable) return { kind: "position", row: unavailable, priority: "unavailable" };

  let best: IsolatedBorrowRow | undefined;
  for (const r of candidates) {
    if (!best) {
      best = r;
      continue;
    }
    // Every remaining candidate has a value LTV and a known maxLTV (else it was picked above).
    const a = r.ltv.kind === "value" ? r.ltv.ltv : 0n;
    const b = best.ltv.kind === "value" ? best.ltv.ltv : 0n;
    if (a * (best.maxLTV ?? 0n) > b * (r.maxLTV ?? 0n)) best = r;
  }
  return best ? { kind: "position", row: best, priority: "highest" } : { kind: "none" };
}

export type OverallStatus = HealthStatus | "loading";

export interface RiskSummary {
  /** One overall status: never "safe" while anything is unknown or loading. */
  status: OverallStatus;
  core: CoreRiskSummary;
  isolated: IsolatedRiskPick;
}

export function coreRiskSummary(input: Pick<OverviewInput, "core" | "markets" | "priceOf">): CoreRiskSummary {
  const { core, markets, priceOf } = input;
  const health = formatHealth({ kind: "hf", healthFactor: core.healthFactor });
  const snapshot = buildCoreSnapshot({
    eMode: core.eMode,
    positions: core.positions,
    configOf: (asset) => markets.find((m) => sameAddress(m.asset, asset))?.config,
    priceOf,
  });
  const risk = coreRisk(snapshot);
  const liquidationPrice: LiquidationPrice = risk.available ? risk.liquidationPrice : { kind: "unavailable", reason: risk.reason };
  // A known HF < 1 is liquidatable whatever else is missing; otherwise unknown data is unavailable.
  const status = health.status === "liquidatable" || risk.available ? health.status : "unavailable";
  return { healthFactor: core.healthFactor, health, liquidationPrice, status };
}

export function riskSummary(input: OverviewInput, rows: readonly PositionRow[]): RiskSummary {
  const core = coreRiskSummary(input);
  const isolated = riskiestIsolated(rows, input.isolated.unknownPairs, input.pairLabel);
  const isolatedStatus: HealthStatus =
    isolated.kind === "none" ? "safe" : isolated.kind === "unknown" ? "unavailable" : isolated.row.health.status;
  const status = worstStatus([core.status, isolatedStatus]);
  return { status: input.loading && status !== "liquidatable" ? "loading" : status, core, isolated };
}

// ---------------------------------------------------------------------------------------------
// Everything the dashboard and the portfolio show
// ---------------------------------------------------------------------------------------------

export interface Overview {
  totals: AccountTotals;
  rows: PositionRow[];
  risk: RiskSummary;
}

export function buildOverview(input: OverviewInput): Overview {
  const { core, markets, priceOf, isolated } = input;
  const totals = accountTotals({
    core: core.positions,
    coreRatesOf: (asset) => {
      const m = markets.find((x) => sameAddress(x.asset, asset));
      return m && { supplyRate: m.supplyRate, borrowRate: m.borrowRate };
    },
    isolated: isolated.positions,
    priceOf,
    // Loading or a failed snapshot: the isolated legs are unavailable, never $0 (FE-07).
    isolatedIncomplete: isolated.incomplete || isolated.loading,
    stamps: {
      core: core.stamp,
      prices: input.pricesStamp,
      isolated: isolated.stamps.snapshots,
      conversions: isolated.stamps.conversions,
      pairs: isolated.stamps.pairs,
    },
  });
  const rows = positionRows(input);
  return { totals, rows, risk: riskSummary(input, rows) };
}
