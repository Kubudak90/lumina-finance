"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { safeBigInt } from "@/lib/format";
import { resultAt, useLuminaMulticall, type ContractCall } from "@/hooks/chain";
import { STAMP_CALLS, STAMP_OFFSET, readStamp } from "@/hooks/useBlockStamp";
import { useIsolatedPairs, type IsolatedPairInfo } from "./useIsolatedPairs";

export interface UserIsolatedPosition extends IsolatedPairInfo {
  /** lent assets (asset shares → amount, previewing interest). */
  suppliedAssets: bigint;
  /** debt (borrow shares → amount, rounded up, previewing interest). */
  borrowedAssets: bigint;
  suppliedShares: bigint;
  borrowedShares: bigint;
  collateralAmount: bigint;
}

/**
 * The connected user's isolated positions: getUserSnapshot per manifest pair (stamped with the
 * block), then share → amount conversions. Polled every 15 s.
 */
export function useUserIsolatedPositions() {
  const { address } = useAccount();
  const { pairs, isLoading: pairsLoading } = useIsolatedPairs();

  const snapshotCalls: ContractCall[] = useMemo(
    () =>
      address
        ? [
            ...STAMP_CALLS,
            ...pairs.map((p) => ({
              address: p.pair,
              abi: ISOLATED_PAIR_ABI,
              functionName: "getUserSnapshot",
              args: [address],
            })),
          ]
        : [],
    [address, pairs],
  );
  const snapshots = useLuminaMulticall(snapshotCalls, { enabled: !!address, policy: QUERY.user });

  type Snapshot = readonly [bigint, bigint, bigint];
  const snapshotData = useMemo(
    () => pairs.map((_, i) => resultAt<Snapshot>(snapshots.results, STAMP_OFFSET + i)),
    [pairs, snapshots.results],
  );

  const conversionCalls: ContractCall[] = useMemo(
    () =>
      pairs.flatMap((p, i) => [
        {
          address: p.pair,
          abi: ISOLATED_PAIR_ABI,
          functionName: "toAssetAmount",
          args: [snapshotData[i]?.[0] ?? 0n, false, true],
        },
        {
          address: p.pair,
          abi: ISOLATED_PAIR_ABI,
          functionName: "toBorrowAmount",
          args: [snapshotData[i]?.[1] ?? 0n, true, true],
        },
      ]),
    [pairs, snapshotData],
  );
  const conversions = useLuminaMulticall(conversionCalls, {
    enabled: !!address && !!snapshots.results,
    policy: QUERY.user,
  });

  const positions: UserIsolatedPosition[] = useMemo(
    () =>
      pairs
        .map((p, i) => {
          const snap = snapshotData[i];
          return {
            ...p,
            suppliedShares: snap?.[0] ?? 0n,
            borrowedShares: snap?.[1] ?? 0n,
            collateralAmount: snap?.[2] ?? 0n,
            suppliedAssets: safeBigInt(resultAt(conversions.results, i * 2)),
            borrowedAssets: safeBigInt(resultAt(conversions.results, i * 2 + 1)),
          };
        })
        .filter((p) => p.suppliedShares > 0n || p.borrowedShares > 0n || p.collateralAmount > 0n),
    [pairs, snapshotData, conversions.results],
  );

  return {
    positions,
    stamp: readStamp(snapshots.results),
    isLoading: pairsLoading || (!!address && (snapshots.isLoading || conversions.isLoading)),
  };
}
