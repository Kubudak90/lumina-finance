import type Decimal from "decimal.js";
import type { LighterSnapshot } from "@/lib/lighter";
import { baseValue, isolatedCollateralBase8 } from "@/lib/prices";
import { aprToApy, coreApy, toDecimal } from "@/lib/risk";
import { oldestStamp, type BlockStamp } from "@/lib/valuation";

export type LuminaLegs = {
  poolSupplyUsd: number;
  poolDebtUsd: number;
  isolatedSupplyUsd: number;
  isolatedDebtUsd: number;
  isolatedCollateralUsd: number;
};

export type CombinedPortfolio = {
  luminaAssetsUsd: number;
  luminaDebtUsd: number;
  luminaNetUsd: number;
  lighterEquityUsd: number | null;
  lighterPerpDeltaUsd: number | null;
  totalUsd: number | null;
  /** Lumina net USD plus signed Lighter perp notional (long +, short −). */
  netDeltaUsd: number | null;
};

export function luminaNetUsd(legs: LuminaLegs): number {
  return (
    legs.poolSupplyUsd +
    legs.isolatedSupplyUsd +
    legs.isolatedCollateralUsd -
    legs.poolDebtUsd -
    legs.isolatedDebtUsd
  );
}

export function lighterPerpDeltaUsd(
  positions: Pick<LighterSnapshot["positions"][number], "side" | "displaySize" | "displayMark">[]
): number {
  return positions.reduce((sum, position) => {
    const notional = position.displaySize * position.displayMark;
    if (position.side === "short") return sum - notional;
    if (position.side === "long") return sum + notional;
    return sum;
  }, 0);
}

export function combinePortfolio(
  lumina: LuminaLegs,
  lighter: Pick<LighterSnapshot, "equity" | "positions"> | null
): CombinedPortfolio {
  const luminaAssetsUsd = lumina.poolSupplyUsd + lumina.isolatedSupplyUsd + lumina.isolatedCollateralUsd;
  const luminaDebtUsd = lumina.poolDebtUsd + lumina.isolatedDebtUsd;
  const luminaNet = luminaAssetsUsd - luminaDebtUsd;
  const lighterEquityUsd = lighter?.equity.total ?? null;
  const lighterPerp = lighter ? lighterPerpDeltaUsd(lighter.positions) : null;
  return {
    luminaAssetsUsd,
    luminaDebtUsd,
    luminaNetUsd: luminaNet,
    lighterEquityUsd,
    lighterPerpDeltaUsd: lighterPerp,
    totalUsd: lighterEquityUsd == null ? luminaNet : luminaNet + lighterEquityUsd,
    netDeltaUsd: lighterPerp == null ? luminaNet : luminaNet + lighterPerp,
  };
}

// ---------------------------------------------------------------------------------------------
// Account totals (ui-usability-v1 spec §3.1): the ONE definition the dashboard and the portfolio use
// ---------------------------------------------------------------------------------------------

export interface TotalsCorePosition {
  asset: string;
  decimals: number;
  /** aToken balance; undefined = unavailable. */
  supplied: bigint | undefined;
  /** Variable debt; undefined = unavailable. */
  borrowed: bigint | undefined;
}

export interface TotalsCoreRates {
  /** Aave ray rates (APR); undefined = unavailable. */
  supplyRate: bigint | undefined;
  borrowRate: bigint | undefined;
}

export interface TotalsIsolatedPosition {
  asset: string;
  assetDecimals: number;
  /** Lent assets; undefined when the share conversion failed. */
  suppliedAssets: bigint | undefined;
  /** Debt; undefined when the share conversion failed. */
  borrowedAssets: bigint | undefined;
  collateralAmount: bigint;
  /** Pair rate: collateral per asset × 1e18. */
  exchangeRate: bigint | undefined;
  /** Pair APRs (fractions) from previewAddInterest; undefined = unavailable. */
  lendApr: Decimal | undefined;
  borrowApr: Decimal | undefined;
}

export interface AccountTotalsInput {
  core: readonly TotalsCorePosition[];
  coreRatesOf: (asset: string) => TotalsCoreRates | undefined;
  isolated: readonly TotalsIsolatedPosition[];
  /** AaveOracle price (base currency, 8 decimals) by asset; undefined = unavailable (FE-06). */
  priceOf: (asset: string) => bigint | undefined;
  /** The isolated list is not known to be complete: loading, or a pair snapshot failed. */
  isolatedIncomplete: boolean;
  /** Block stamps of every read the totals combine. */
  stamps: {
    core: BlockStamp | undefined;
    prices: BlockStamp | undefined;
    isolated: BlockStamp | undefined;
    conversions: BlockStamp | undefined;
    pairs: BlockStamp | undefined;
  };
}

/** USD legs in base currency (8 decimals); undefined = unavailable, never a silently lower $0. */
export interface AccountLegs {
  coreSupplied: bigint | undefined;
  coreDebt: bigint | undefined;
  isolatedLent: bigint | undefined;
  isolatedCollateral: bigint | undefined;
  isolatedDebt: bigint | undefined;
}

export interface AccountTotals {
  /** core supplied + isolated lent + isolated collateral − core debt − isolated debt (wallets excluded). */
  netWorth: bigint | undefined;
  /** core supplied + isolated lent + isolated collateral. */
  deposits: bigint | undefined;
  /** core debt + isolated debt. */
  debt: bigint | undefined;
  legs: AccountLegs;
  /**
   * (Σ earning USD × APY − Σ debt USD × APY) / net worth, posted collateral earning 0. undefined
   * ("—") when net worth is ≤ 0 or unavailable, or a non-zero earning / debt position has no USD
   * value or APY. Zero balances are ignored.
   */
  netApy: Decimal | undefined;
  /** The oldest block among core, prices, isolated snapshots, conversions and pairs. */
  stamp: BlockStamp | undefined;
  incomplete: boolean;
}

interface Leg {
  amount: bigint | undefined;
  value: bigint | undefined;
  /** +1 earning, −1 debt, 0 posted collateral (earns nothing). */
  sign: 1 | -1 | 0;
  apy: Decimal | undefined;
}

function sumLegs(legs: readonly Leg[]): bigint | undefined {
  let total = 0n;
  for (const leg of legs) {
    if (leg.amount === 0n) continue;
    if (leg.value === undefined) return undefined;
    total += leg.value;
  }
  return total;
}

const value8 = (amount: bigint | undefined, decimals: number, price: bigint | undefined) =>
  amount === undefined ? undefined : amount === 0n ? 0n : price === undefined || price <= 0n ? undefined : baseValue(amount, decimals, price);

export function accountTotals(input: AccountTotalsInput): AccountTotals {
  const { priceOf, isolatedIncomplete } = input;
  const supply: Leg[] = [];
  const coreDebt: Leg[] = [];
  for (const p of input.core) {
    const price = priceOf(p.asset);
    const rates = input.coreRatesOf(p.asset);
    supply.push({ amount: p.supplied, value: value8(p.supplied, p.decimals, price), sign: 1, apy: coreApy(rates?.supplyRate) });
    coreDebt.push({ amount: p.borrowed, value: value8(p.borrowed, p.decimals, price), sign: -1, apy: coreApy(rates?.borrowRate) });
  }
  const lent: Leg[] = [];
  const collateral: Leg[] = [];
  const isoDebt: Leg[] = [];
  for (const p of input.isolated) {
    const price = priceOf(p.asset);
    lent.push({ amount: p.suppliedAssets, value: value8(p.suppliedAssets, p.assetDecimals, price), sign: 1, apy: p.lendApr && aprToApy(p.lendApr) });
    isoDebt.push({ amount: p.borrowedAssets, value: value8(p.borrowedAssets, p.assetDecimals, price), sign: -1, apy: p.borrowApr && aprToApy(p.borrowApr) });
    const cValue =
      p.collateralAmount === 0n
        ? 0n
        : p.exchangeRate === undefined || p.exchangeRate <= 0n || price === undefined || price <= 0n
          ? undefined
          : isolatedCollateralBase8(p.collateralAmount, p.exchangeRate, p.assetDecimals, price);
    collateral.push({ amount: p.collateralAmount, value: cValue, sign: 0, apy: undefined });
  }

  const legs: AccountLegs = {
    coreSupplied: sumLegs(supply),
    coreDebt: sumLegs(coreDebt),
    isolatedLent: isolatedIncomplete ? undefined : sumLegs(lent),
    isolatedCollateral: isolatedIncomplete ? undefined : sumLegs(collateral),
    isolatedDebt: isolatedIncomplete ? undefined : sumLegs(isoDebt),
  };
  const add = (...v: (bigint | undefined)[]) => (v.some((x) => x === undefined) ? undefined : v.reduce<bigint>((a, b) => a + b!, 0n));
  const deposits = add(legs.coreSupplied, legs.isolatedLent, legs.isolatedCollateral);
  const debt = add(legs.coreDebt, legs.isolatedDebt);
  const netWorth = deposits === undefined || debt === undefined ? undefined : deposits - debt;

  let netApy: Decimal | undefined;
  if (netWorth !== undefined && netWorth > 0n) {
    let weighted: Decimal | undefined = toDecimal(0);
    for (const leg of [...supply, ...coreDebt, ...lent, ...isoDebt]) {
      if (leg.amount === 0n) continue;
      if (leg.value === undefined || leg.apy === undefined) {
        weighted = undefined;
        break;
      }
      weighted = weighted!.plus(leg.apy.mul(leg.value.toString()).mul(leg.sign));
    }
    netApy = weighted?.div(netWorth.toString());
  }

  const { core, prices, isolated, conversions, pairs } = input.stamps;
  return {
    netWorth,
    deposits,
    debt,
    legs,
    netApy,
    stamp: oldestStamp([core, prices, isolated, conversions, pairs]),
    incomplete: isolatedIncomplete,
  };
}

/**
 * Freshness from data age, never from mere presence (FE-07). "fresh" needs a positive age signal:
 * a recent block timestamp (Lumina) or a recent websocket pong (Lighter).
 */
export type FreshnessStatus = "fresh" | "stale" | "offline" | "unknown";

export function lighterFreshness(
  wsConnected: boolean,
  lastPongAt: number | null,
  now: number,
  staleAfterMs = 15_000
): FreshnessStatus {
  if (!wsConnected && lastPongAt == null) return "offline";
  // Connected but never answered a ping: no evidence the stream is current.
  if (lastPongAt == null) return "unknown";
  if (now - lastPongAt > staleAfterMs) return "stale";
  return wsConnected ? "fresh" : "stale";
}

/** Seconds between the block a read was taken at and `nowMs` (clamped at 0), or null. */
export function blockAgeSeconds(blockTimestampSec: bigint | number | undefined, nowMs: number): number | null {
  if (blockTimestampSec === undefined || nowMs <= 0) return null;
  const age = Math.floor(nowMs / 1000) - Number(blockTimestampSec);
  return age > 0 ? age : 0;
}

/** Lumina on-chain data: fresh while the block it was read at is at most `staleAfterSec` old. */
export function chainFreshness(
  blockTimestampSec: bigint | number | undefined,
  nowMs: number,
  staleAfterSec: number
): FreshnessStatus {
  const age = blockAgeSeconds(blockTimestampSec, nowMs);
  if (age === null) return "unknown";
  return age <= staleAfterSec ? "fresh" : "stale";
}
