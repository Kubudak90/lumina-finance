"use client";

import { useAccount } from "wagmi";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useUserIsolatedPositions } from "@/hooks/useUserIsolatedPositions";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { LUMINA } from "@/lib/deployments";
import { buildOverview, type Overview } from "@/lib/overview";

/** "USDC/WETH" for a pair address (lowercase), from the manifest. */
export function pairLabel(pair: string): string {
  const m = LUMINA.isolatedMarkets.find((x) => x.pair?.toLowerCase() === pair.toLowerCase());
  return m ? `${m.assetSymbol}/${m.collateralSymbol}` : pair;
}

/**
 * The connected account across both venues (spec ui-usability-v1 §3.3): totals from
 * `accountTotals()`, the "Your positions" rows and the risk card. The dashboard and the portfolio
 * both read it, so their totals are the same numbers. Reads only through the existing hooks
 * (FE-03), at their polling cadence (FE-07).
 */
export function useAccountOverview(): Overview & { connected: boolean; loading: boolean } {
  const { isConnected } = useAccount();
  const core = useUserPosition();
  const iso = useUserIsolatedPositions();
  const { markets, isLoading: marketsLoading } = useAllMarkets();
  const { priceOf, stamp: pricesStamp, isLoading: pricesLoading } = useOraclePrices();
  const loading = !!(core.isLoading || iso.isLoading || marketsLoading || pricesLoading);

  // Cheap and pure; the inputs are fresh objects on every poll anyway, so no memo.
  const overview = buildOverview({
    core: {
      positions: core.positions,
      healthFactor: core.accountData?.healthFactor,
      eMode: core.eMode,
      stamp: core.stamp,
      loading: !!core.isLoading,
    },
    markets,
    priceOf,
    pricesStamp,
    isolated: {
      positions: iso.positions,
      unknownPairs: iso.unknownPairs,
      incomplete: iso.incomplete,
      loading: iso.isLoading,
      stamps: { snapshots: iso.stamp, conversions: iso.conversionStamp, pairs: iso.pairsStamp },
    },
    pairLabel,
    loading,
  });

  return { ...overview, connected: isConnected, loading };
}
