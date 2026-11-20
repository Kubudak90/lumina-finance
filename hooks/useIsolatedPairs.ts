"use client";

import { useMemo } from "react";
import { DUAL_ORACLE_ABI, ISOLATED_PAIR_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { LUMINA, type IsolatedMarket } from "@/lib/deployments";
import { safeBigInt } from "@/lib/format";
import { LTV_PRECISION } from "@/lib/borrowMax";
import { resultAt, useLuminaMulticall, type ContractCall } from "@/hooks/chain";

export interface IsolatedPairInfo extends IsolatedMarket {
  /** Pair address is in the manifest. */
  deployed: boolean;
  /** pair.maxLTV() (1e5 = 100%); 0 until read. */
  maxLTV: bigint;
  totalAssetAmount: bigint;
  totalAssetShares: bigint;
  totalBorrowAmount: bigint;
  totalBorrowShares: bigint;
  totalCollateral: bigint;
  borrowLimit: bigint;
  /** totalAsset − totalBorrow. */
  availableLiquidity: bigint;
  utilization: number;
  /** Pair oracle rate (collateral per asset × 1e18, high = low on Lighter); undefined if unreadable. */
  exchangeRate: bigint | undefined;
  /** Dual oracle bad-data flag (= price guard blocks borrows). */
  oracleBadData: boolean | undefined;
  loaded: boolean;
}

const PER_PAIR = 4;

/**
 * The isolated pairs listed in the manifest (no registry discovery), with accounting, limits and
 * the pair oracle's exchange rate. Polled with prices (15 s): borrow MAX depends on the rate.
 */
export function useIsolatedPairs() {
  const calls: ContractCall[] = useMemo(
    () =>
      LUMINA.isolatedMarkets.flatMap((m) => [
        { address: m.pair, abi: ISOLATED_PAIR_ABI, functionName: "maxLTV" },
        { address: m.pair, abi: ISOLATED_PAIR_ABI, functionName: "getPairAccounting" },
        { address: m.pair, abi: ISOLATED_PAIR_ABI, functionName: "borrowLimit" },
        { address: m.dualOracle, abi: DUAL_ORACLE_ABI, functionName: "getPrices" },
      ]),
    [],
  );
  const query = useLuminaMulticall(calls, { policy: QUERY.prices });
  const results = query.results;

  const pairs: IsolatedPairInfo[] = useMemo(
    () =>
      LUMINA.isolatedMarkets.map((m, i) => {
        const base = i * PER_PAIR;
        const accounting = resultAt<readonly [bigint, bigint, bigint, bigint, bigint]>(results, base + 1);
        const prices = resultAt<readonly [boolean, bigint, bigint]>(results, base + 3);
        const totalAssetAmount = accounting?.[0] ?? 0n;
        const totalBorrowAmount = accounting?.[2] ?? 0n;
        return {
          ...m,
          deployed: m.pair !== null,
          maxLTV: safeBigInt(resultAt(results, base)),
          totalAssetAmount,
          totalAssetShares: accounting?.[1] ?? 0n,
          totalBorrowAmount,
          totalBorrowShares: accounting?.[3] ?? 0n,
          totalCollateral: accounting?.[4] ?? 0n,
          borrowLimit: safeBigInt(resultAt(results, base + 2)),
          availableLiquidity: totalAssetAmount > totalBorrowAmount ? totalAssetAmount - totalBorrowAmount : 0n,
          utilization:
            totalAssetAmount > 0n ? Number((totalBorrowAmount * 10_000n) / totalAssetAmount) / 100 : 0,
          exchangeRate: prices && prices[2] > 0n ? prices[2] : undefined,
          oracleBadData: prices?.[0],
          loaded: accounting !== undefined,
        };
      }),
    [results],
  );

  return { pairs, isLoading: query.isLoading };
}

export const ISOLATED_LTV_PRECISION = LTV_PRECISION;
