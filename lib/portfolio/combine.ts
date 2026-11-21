import type { LighterSnapshot } from "@/lib/lighter";

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
