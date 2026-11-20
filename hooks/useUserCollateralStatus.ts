"use client";

import { useCallback } from "react";
import { useUserPosition } from "@/hooks/useUserPosition";

/** Collateral flags per asset, from the shared position read. */
export function useUserCollateralStatus() {
  const { positions, isLoading } = useUserPosition();
  const isCollateralEnabled = useCallback(
    (asset: string): boolean =>
      positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase())?.collateralEnabled ?? false,
    [positions],
  );
  return { isCollateralEnabled, isLoading };
}
