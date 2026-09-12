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

export type FreshnessStatus = "live" | "stale" | "offline" | "unknown";

export function lighterFreshness(
  wsConnected: boolean,
  lastPongAt: number | null,
  now?: number,
  staleAfterMs = 15_000
): FreshnessStatus {
  if (!wsConnected && lastPongAt == null) return "offline";
  if (now != null && lastPongAt != null && now - lastPongAt > staleAfterMs) return "stale";
  if (wsConnected) return "live";
  return "stale";
}

export function luminaFreshness(hasOnChain: boolean, hasPrices: boolean): FreshnessStatus {
  if (!hasOnChain && !hasPrices) return "unknown";
  if (!hasOnChain || !hasPrices) return "stale";
  return "live";
}
