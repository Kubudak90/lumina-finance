"use client";

import { useUserPosition } from "@/hooks/useUserPosition";

/** Health factor (WAD; uint256 max = no debt) from the shared, polled position read. */
export function useHealthFactor() {
  const { accountData, stamp, isLoading } = useUserPosition();
  return { healthFactor: accountData?.healthFactor, stamp, isLoading };
}
