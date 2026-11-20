"use client";

import { useMemo } from "react";
import { DUAL_ORACLE_ABI, ISOLATED_PAIR_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { LUMINA, type IsolatedMarket } from "@/lib/deployments";
import { LTV_PRECISION } from "@/lib/borrowMax";
import { bigintAt, resultAt, useLuminaMulticall, type CallResult, type ContractCall } from "@/hooks/chain";
import { STAMP_CALLS, STAMP_OFFSET, readStamp, type BlockStamp } from "@/hooks/useBlockStamp";

/** On-chain fields are `undefined` when their read failed or is loading (never zero). */
export interface IsolatedPairInfo extends IsolatedMarket {
  /** Pair address is in the manifest. */
  deployed: boolean;
  /** pair.maxLTV() (1e5 = 100%). */
  maxLTV: bigint | undefined;
  totalAssetAmount: bigint | undefined;
  totalAssetShares: bigint | undefined;
  totalBorrowAmount: bigint | undefined;
  totalBorrowShares: bigint | undefined;
  totalCollateral: bigint | undefined;
  borrowLimit: bigint | undefined;
  /** totalAsset − totalBorrow. */
  availableLiquidity: bigint | undefined;
  utilization: number | undefined;
  /**
   * Pair oracle rate, oriented as the pair uses it: units of THIS pair's collateral per unit of
   * THIS pair's asset × 1e18 (LighterDualOracle.getPrices().priceHigh; high = low on Lighter).
   */
  exchangeRate: bigint | undefined;
  /** Dual oracle bad-data flag (= price guard blocks borrows); undefined if unreadable. */
  oracleBadData: boolean | undefined;
  loaded: boolean;
}

const PER_PAIR = 4;

/** Parse one pair's slice of the pairs multicall (exported for tests). */
export function parsePair(m: IsolatedMarket, results: readonly CallResult[] | undefined, base: number): IsolatedPairInfo {
  const accounting = resultAt<readonly [bigint, bigint, bigint, bigint, bigint]>(results, base + 1);
  const prices = resultAt<readonly [boolean, bigint, bigint]>(results, base + 3);
  const totalAssetAmount = accounting?.[0];
  const totalBorrowAmount = accounting?.[2];
  return {
    ...m,
    deployed: m.pair !== null,
    maxLTV: bigintAt(results, base),
    totalAssetAmount,
    totalAssetShares: accounting?.[1],
    totalBorrowAmount,
    totalBorrowShares: accounting?.[3],
    totalCollateral: accounting?.[4],
    borrowLimit: bigintAt(results, base + 2),
    availableLiquidity:
      totalAssetAmount === undefined || totalBorrowAmount === undefined
        ? undefined
        : totalAssetAmount > totalBorrowAmount
          ? totalAssetAmount - totalBorrowAmount
          : 0n,
    utilization:
      totalAssetAmount === undefined || totalBorrowAmount === undefined
        ? undefined
        : totalAssetAmount > 0n
          ? Number((totalBorrowAmount * 10_000n) / totalAssetAmount) / 100
          : 0,
    exchangeRate: prices && typeof prices[2] === "bigint" && prices[2] > 0n ? prices[2] : undefined,
    oracleBadData: prices && typeof prices[0] === "boolean" ? prices[0] : undefined,
    loaded: accounting !== undefined,
  };
}

/**
 * The isolated pairs listed in the manifest (no registry discovery), with accounting, limits and
 * the pair oracle's exchange rate, stamped with the block. Polled with prices (15 s).
 */
export function useIsolatedPairs(): { pairs: IsolatedPairInfo[]; stamp: BlockStamp | undefined; isLoading: boolean } {
  const calls: ContractCall[] = useMemo(
    () => [
      ...STAMP_CALLS,
      ...LUMINA.isolatedMarkets.flatMap((m) => [
        { address: m.pair, abi: ISOLATED_PAIR_ABI, functionName: "maxLTV" },
        { address: m.pair, abi: ISOLATED_PAIR_ABI, functionName: "getPairAccounting" },
        { address: m.pair, abi: ISOLATED_PAIR_ABI, functionName: "borrowLimit" },
        { address: m.dualOracle, abi: DUAL_ORACLE_ABI, functionName: "getPrices" },
      ]),
    ],
    [],
  );
  const query = useLuminaMulticall(calls, { policy: QUERY.prices });
  const results = query.results;

  const pairs = useMemo(
    () => LUMINA.isolatedMarkets.map((m, i) => parsePair(m, results, STAMP_OFFSET + i * PER_PAIR)),
    [results],
  );

  return { pairs, stamp: readStamp(results), isLoading: query.isLoading };
}

/** One pair by address, re-derived from the polled data on every render. */
export function useIsolatedPair(pair: string | null | undefined): IsolatedPairInfo | undefined {
  const { pairs } = useIsolatedPairs();
  return pair ? pairs.find((p) => p.pair?.toLowerCase() === pair.toLowerCase()) : undefined;
}

export const ISOLATED_LTV_PRECISION = LTV_PRECISION;
