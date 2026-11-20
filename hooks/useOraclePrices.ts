"use client";

import { useCallback, useMemo } from "react";
import { AAVE_ORACLE_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { LUMINA } from "@/lib/deployments";
import { priceKey, type PriceMap } from "@/lib/prices";
import { resultAt, useLuminaMulticall, type ContractCall } from "@/hooks/chain";
import { STAMP_CALLS, STAMP_OFFSET, readStamp } from "@/hooks/useBlockStamp";

/**
 * AaveOracle.getAssetPrice for every core asset (base currency, 8 decimals), keyed by lowercase
 * asset address. The only price source for USD figures (FE-06). A price that fails to read (e.g.
 * the Lighter Core source reverting) stays undefined and the UI shows "—", never $0.
 */
export function useOraclePrices() {
  const oracle = LUMINA.contracts.aaveOracle;
  const calls: ContractCall[] = useMemo(
    () => [
      ...STAMP_CALLS,
      ...LUMINA.coreMarkets.map((m) => ({
        address: oracle,
        abi: AAVE_ORACLE_ABI,
        functionName: "getAssetPrice",
        args: [m.asset],
      })),
    ],
    [oracle],
  );
  const query = useLuminaMulticall(calls, { policy: QUERY.prices });

  const prices: PriceMap = useMemo(() => {
    const map = new Map<string, bigint>();
    LUMINA.coreMarkets.forEach((m, i) => {
      const price = resultAt<bigint>(query.results, STAMP_OFFSET + i);
      if (typeof price === "bigint" && price > 0n) map.set(priceKey(m.asset), price);
    });
    return map;
  }, [query.results]);

  const priceOf = useCallback(
    (asset: string | undefined) => (asset ? prices.get(priceKey(asset)) : undefined),
    [prices],
  );

  return {
    prices,
    priceOf,
    stamp: readStamp(query.results),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
