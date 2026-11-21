"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { bigintAt, resultAt, useLuminaMulticall, type CallResult, type ContractCall } from "@/hooks/chain";
import { STAMP_CALLS, STAMP_OFFSET, readStamp, type BlockStamp } from "@/hooks/useBlockStamp";
import { useIsolatedPairs, type IsolatedPairInfo } from "./useIsolatedPairs";

export interface UserIsolatedPosition extends IsolatedPairInfo {
  /** lent assets (asset shares → amount, previewing interest); undefined if the conversion failed. */
  suppliedAssets: bigint | undefined;
  /** debt (borrow shares → amount, rounded up, previewing interest); undefined if it failed. */
  borrowedAssets: bigint | undefined;
  suppliedShares: bigint;
  borrowedShares: bigint;
  collateralAmount: bigint;
}

type Snapshot = readonly [bigint, bigint, bigint];

/**
 * Combine snapshots and conversions (exported for tests). A share balance of 0 needs no
 * conversion; a non-zero balance whose conversion failed stays `undefined`, never 0.
 */
export function combineIsolatedPositions(
  pairs: readonly IsolatedPairInfo[],
  snapshots: readonly (Snapshot | undefined)[],
  conversions: readonly CallResult[] | undefined,
  conversionOffset: number,
): UserIsolatedPosition[] {
  return pairs
    .map((p, i) => {
      const snap = snapshots[i];
      if (!snap) return null;
      const [suppliedShares, borrowedShares, collateralAmount] = snap;
      return {
        ...p,
        suppliedShares,
        borrowedShares,
        collateralAmount,
        suppliedAssets: suppliedShares === 0n ? 0n : bigintAt(conversions, conversionOffset + i * 2),
        borrowedAssets: borrowedShares === 0n ? 0n : bigintAt(conversions, conversionOffset + i * 2 + 1),
      };
    })
    .filter(
      (p): p is UserIsolatedPosition =>
        p !== null && (p.suppliedShares > 0n || p.borrowedShares > 0n || p.collateralAmount > 0n),
    );
}

/**
 * The connected user's isolated positions: getUserSnapshot per manifest pair, then share → amount
 * conversions, each multicall stamped with its block. Polled every 15 s.
 */
export function useUserIsolatedPositions(): {
  positions: UserIsolatedPosition[];
  /**
   * The position list is not known to be complete: the snapshot multicall is loading or failed, or
   * a deployed pair's snapshot failed (Gemini r2 M4). Totals must then be "unavailable", never $0.
   */
  incomplete: boolean;
  /** Deployed pairs (lowercase) whose snapshot did not load: their rows are "unavailable". */
  unknownPairs: readonly string[];
  /** Pairs (lowercase) whose snapshot loaded: absent from `positions` means "no position". */
  knownPairs: ReadonlySet<string>;
  stamp: BlockStamp | undefined;
  conversionStamp: BlockStamp | undefined;
  pairsStamp: BlockStamp | undefined;
  isLoading: boolean;
} {
  const { address } = useAccount();
  const { pairs, stamp: pairsStamp, isLoading: pairsLoading } = useIsolatedPairs();

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

  const snapshotData = useMemo(
    () =>
      pairs.map((_, i) => {
        const s = resultAt<readonly unknown[]>(snapshots.results, STAMP_OFFSET + i);
        return s && s.length >= 3 && s.every((v) => typeof v === "bigint") ? (s as unknown as Snapshot) : undefined;
      }),
    [pairs, snapshots.results],
  );

  const conversionCalls: ContractCall[] = useMemo(
    () => [
      ...STAMP_CALLS,
      ...pairs.flatMap((p, i) => [
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
    ],
    [pairs, snapshotData],
  );
  const conversions = useLuminaMulticall(conversionCalls, {
    enabled: !!address && !!snapshots.results,
    policy: QUERY.user,
  });

  const positions = useMemo(
    () => combineIsolatedPositions(pairs, snapshotData, conversions.results, STAMP_OFFSET),
    [pairs, snapshotData, conversions.results],
  );

  const deployedPairs = pairs.filter((p) => p.pair !== null);
  const unknownPairs = deployedPairs
    .filter((p) => snapshotData[pairs.indexOf(p)] === undefined)
    .map((p) => p.pair!.toLowerCase());
  const knownPairs = new Set(
    deployedPairs.filter((p) => snapshotData[pairs.indexOf(p)] !== undefined).map((p) => p.pair!.toLowerCase()),
  );

  return {
    positions,
    incomplete: !!address && unknownPairs.length > 0,
    unknownPairs,
    knownPairs,
    stamp: readStamp(snapshots.results),
    conversionStamp: readStamp(conversions.results),
    pairsStamp,
    isLoading: pairsLoading || (!!address && (snapshots.isLoading || conversions.isLoading)),
  };
}

export type IsolatedPositionState =
  /** Snapshot loaded: `position` is the user's position, or undefined if they have none. */
  | { status: "known"; position: UserIsolatedPosition | undefined }
  /** Snapshot loading or failed: the position is unknown (never treated as empty). */
  | { status: "unknown"; position: undefined };

/** The user's position in one pair, re-derived from the polled data on every render. */
export function useIsolatedPosition(pair: string | null | undefined): IsolatedPositionState {
  const { positions, knownPairs } = useUserIsolatedPositions();
  if (!pair || !knownPairs.has(pair.toLowerCase())) return { status: "unknown", position: undefined };
  return { status: "known", position: positions.find((p) => p.pair?.toLowerCase() === pair.toLowerCase()) };
}
