import { useReadContracts, useAccount } from "wagmi";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { useIsolatedPairs, type IsolatedPairInfo } from "./useIsolatedPairs";

export interface UserIsolatedPosition extends IsolatedPairInfo {
  /** lent assets (assetShares × current rate) */
  suppliedAssets: bigint;
  /** debt amount (borrowShares × current rate) */
  borrowedAssets: bigint;
  suppliedShares: bigint;
  borrowedShares: bigint;
  collateralAmount: bigint;
}

/**
 * Reads each pair's getUserSnapshot + toAssetAmount/toBorrowAmount conversions
 * for the connected user. Returns only pairs where the user has a non-zero
 * lend, borrow, or collateral balance.
 */
export function useUserIsolatedPositions() {
  const { address } = useAccount();
  const { pairs, isLoading: pairsLoading } = useIsolatedPairs();
  const enabled = !!address && pairs.length > 0;

  // Step 1: per-pair getUserSnapshot
  const snapshotContracts = pairs.map((p) => ({
    address: p.pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "getUserSnapshot" as const,
    args: address ? ([address] as const) : undefined,
  }));
  const snapshots = useReadContracts({
    contracts: enabled ? snapshotContracts : [],
    query: { enabled, refetchInterval: 15_000 },
  });

  type Snapshot = readonly [bigint, bigint, bigint];
  const snapshotData: (Snapshot | undefined)[] = pairs.map(
    (_, i) => (snapshots.data?.[i]?.result as Snapshot | undefined),
  );

  // Step 2: convert shares → underlying amounts (asset for lend, borrow for debt)
  const conversionContracts = pairs.flatMap((p, i) => {
    const snap = snapshotData[i];
    return [
      // toAssetAmount(assetShares, false, true) → underlying assets
      {
        address: p.pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "toAssetAmount" as const,
        args: [snap?.[0] ?? 0n, false, true] as const,
      },
      // toBorrowAmount(borrowShares, true, true) → underlying debt (round up)
      {
        address: p.pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "toBorrowAmount" as const,
        args: [snap?.[1] ?? 0n, true, true] as const,
      },
    ];
  });

  const conversions = useReadContracts({
    contracts: enabled && snapshots.data ? conversionContracts : [],
    query: { enabled: enabled && !!snapshots.data, refetchInterval: 15_000 },
  });

  const positions: UserIsolatedPosition[] = pairs
    .map((p, i) => {
      const snap = snapshotData[i];
      const assetAmount = (conversions.data?.[i * 2]?.result as bigint | undefined) ?? 0n;
      const borrowAmount = (conversions.data?.[i * 2 + 1]?.result as bigint | undefined) ?? 0n;
      return {
        ...p,
        suppliedShares: snap?.[0] ?? 0n,
        borrowedShares: snap?.[1] ?? 0n,
        collateralAmount: snap?.[2] ?? 0n,
        suppliedAssets: assetAmount,
        borrowedAssets: borrowAmount,
      };
    })
    .filter((p) => p.suppliedShares > 0n || p.borrowedShares > 0n || p.collateralAmount > 0n);

  return {
    positions,
    isLoading: pairsLoading || snapshots.isLoading || conversions.isLoading,
  };
}
