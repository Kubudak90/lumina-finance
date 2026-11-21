"use client";

import { PRICE_GUARD_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { LUMINA } from "@/lib/deployments";
import { describeGuardStatus, type GuardStatus } from "@/lib/guard";
import { resultAt, useLuminaMulticall } from "@/hooks/chain";

/** LuminaPriceGuard.borrowStatus(): whether borrows are open and, if not, why. */
export function useGuardStatus(): GuardStatus & { isLoading: boolean } {
  const query = useLuminaMulticall(
    [{ address: LUMINA.contracts.priceGuard, abi: PRICE_GUARD_ABI, functionName: "borrowStatus" }],
    { policy: QUERY.prices },
  );
  const raw = resultAt<readonly [number, number]>(query.results, 0);
  const status = describeGuardStatus(raw?.[0], raw?.[1] ?? 0, LUMINA.guard);
  return { ...status, isLoading: query.isLoading };
}
