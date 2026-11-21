"use client";

import { useEffect, useMemo } from "react";
import { DATA_PROVIDER_ABI, DUAL_ORACLE_ABI, ISOLATED_PAIR_ABI, POOL_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { LUMINA } from "@/lib/deployments";
import { oldestStamp } from "@/lib/valuation";
import { vaultToAmount, type VaultTotals } from "@/lib/approvals";
import { buildCoreSnapshot, type CoreSnapshot, type IsolatedState } from "@/lib/risk";
import { bigintAt, resultAt, useLuminaMulticall, type CallResult, type ContractCall } from "@/hooks/chain";
import { STAMP_CALLS, readStamp, type BlockStamp } from "@/hooks/useBlockStamp";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useOraclePrices } from "@/hooks/useOraclePrices";

/**
 * Reads behind the transaction flow's summaries (ui-usability-v1 §3.2). Every read goes through
 * hooks/chain (FE-03) and carries a block stamp, so a success screen can wait for a read at or
 * after the receipt block before it shows the after-state.
 */

// =============================================================================================
// After-state gating
// =============================================================================================

export type AfterReadStatus = "reading" | "ready" | "unavailable";

/**
 * Whether a stamped read can show the after-state of a transaction mined in `receiptBlock`:
 * "reading" until a read at a block ≥ the receipt block arrives, "unavailable" when the read
 * failed (or carries no stamp, so its block cannot be checked).
 */
export function afterReadStatus(p: {
  receiptBlock: bigint | undefined;
  stamp: BlockStamp | undefined;
  /** The read failed. */
  failed: boolean;
  /** The read has answered at least once (a missing stamp then means it is unreadable). */
  settled: boolean;
}): AfterReadStatus {
  if (p.failed || p.receiptBlock === undefined) return "unavailable";
  if (!p.stamp) return p.settled ? "unavailable" : "reading";
  return p.stamp.number >= p.receiptBlock ? "ready" : "reading";
}

const CATCH_UP_MS = 2_000;

/** While a read is behind the receipt block, re-read every 2 s instead of waiting for the poll. */
export function useCatchUp(behind: boolean, refetch: (() => unknown) | undefined) {
  useEffect(() => {
    if (!behind || !refetch) return;
    const id = setInterval(() => void refetch(), CATCH_UP_MS);
    return () => clearInterval(id);
  }, [behind, refetch]);
}

// =============================================================================================
// Core: the connected user's snapshot (useUserPosition + reserve configs + oracle prices)
// =============================================================================================

/**
 * The connected user's core snapshot for `lib/risk.ts` (spec §3.1): per-reserve balances, flags and
 * eMode from the position multicall, reserve LTV / LT from the market multicall, AaveOracle prices.
 * Before and after of an action are both computed from this one snapshot.
 */
export function useCoreRiskInputs() {
  const position = useUserPosition();
  const { getMarket } = useAllMarkets();
  const prices = useOraclePrices();
  const snapshot: CoreSnapshot = buildCoreSnapshot({
    eMode: position.eMode,
    positions: position.positions,
    configOf: (asset) => getMarket(asset)?.config,
    priceOf: prices.priceOf,
  });
  return {
    snapshot,
    /** Oldest block among the position and price reads (FreshnessStamp). */
    stamp: oldestStamp([position.stamp, prices.stamp]),
    /** Block of the position read: the after-state waits for it to reach the receipt block. */
    positionStamp: position.stamp,
    positionFailed: position.isError === true,
    positionSettled: position.isLoading !== true,
    refetchPosition: position.refetch as (() => unknown) | undefined,
    positions: position.positions,
    accountData: position.accountData,
    getMarket,
    priceOf: prices.priceOf,
  };
}

export type CoreRiskInputs = ReturnType<typeof useCoreRiskInputs>;

// =============================================================================================
// Isolated: one account's position in one pair, all from ONE block
// =============================================================================================

export interface IsolatedAccountRead {
  /** Inputs of `lib/risk.ts` isolated maths (debt previewing interest, as toBorrowAmount). */
  state: IsolatedState;
  /** Lent amount (asset shares at the previewed totalAsset, rounded down, as toAssetAmount). */
  lent: bigint | undefined;
  assetShares: bigint | undefined;
  /**
   * The pair's limits from the SAME block (U4 review r1 #3): free liquidity (previewed totalAsset −
   * totalBorrow, floored at 0) and borrowLimit, so a modal's MAX never mixes blocks.
   */
  availableLiquidity: bigint | undefined;
  borrowLimit: bigint | undefined;
  stamp: BlockStamp | undefined;
  failed: boolean;
  settled: boolean;
  refetch: () => unknown;
}

const isBigints = (v: unknown, n: number): v is readonly bigint[] =>
  Array.isArray(v) && v.length >= n && v.slice(0, n).every((x) => typeof x === "bigint");

/** Parse [stamp ×2, getUserSnapshot, getPairAccounting, maxLTV, getPrices, borrowLimit] (exported for tests). */
export function parseIsolatedAccount(results: readonly CallResult[] | undefined): Omit<IsolatedAccountRead, "failed" | "settled" | "refetch"> {
  const snap = resultAt<unknown>(results, 2);
  const acc = resultAt<unknown>(results, 3);
  const prices = resultAt<readonly unknown[]>(results, 5);
  const snapshot = isBigints(snap, 3) ? snap : undefined;
  const accounting = isBigints(acc, 4) ? acc : undefined;
  const totalAsset: VaultTotals | undefined = accounting ? { amount: accounting[0], shares: accounting[1] } : undefined;
  const totalBorrow: VaultTotals | undefined = accounting ? { amount: accounting[2], shares: accounting[3] } : undefined;
  const assetShares = snapshot?.[0];
  const borrowedShares = snapshot?.[1];
  const rate = prices && typeof prices[2] === "bigint" && prices[2] > 0n ? prices[2] : undefined;
  const debt =
    borrowedShares === undefined ? undefined : borrowedShares === 0n ? 0n : totalBorrow ? vaultToAmount(totalBorrow, borrowedShares, true) : undefined;
  const lent = assetShares === undefined ? undefined : assetShares === 0n ? 0n : totalAsset ? vaultToAmount(totalAsset, assetShares, false) : undefined;
  return {
    state: {
      debt,
      borrowedShares,
      collateral: snapshot?.[2],
      maxLTV: bigintAt(results, 4),
      exchangeRate: rate,
      isBadData: prices && typeof prices[0] === "boolean" ? prices[0] : undefined,
      totalBorrow,
    },
    lent,
    assetShares,
    availableLiquidity:
      totalAsset && totalBorrow ? (totalAsset.amount > totalBorrow.amount ? totalAsset.amount - totalBorrow.amount : 0n) : undefined,
    borrowLimit: bigintAt(results, 6),
    stamp: readStamp(results),
  };
}

/** The account's position in the read is known (snapshot and its debt conversion both read). */
export function isolatedPositionKnown(read: Pick<IsolatedAccountRead, "state">): boolean {
  const { debt, collateral, borrowedShares } = read.state;
  return debt !== undefined && collateral !== undefined && borrowedShares !== undefined;
}

/**
 * `account`'s position in `pair`, its totals, maxLTV, borrowLimit and the dual oracle's rate in one
 * stamped multicall: the before-state of an isolated summary and, after a receipt, the
 * after-state. The borrower modals also take their form values, MAX and price block from it, so
 * the form and the summary always describe one block (U4 review r1 #3). Existing view functions
 * only (getUserSnapshot, getPairAccounting, maxLTV, getPrices, borrowLimit).
 */
export function useIsolatedAccountRead(
  pair: `0x${string}` | null | undefined,
  dualOracle: `0x${string}` | null | undefined,
  account: `0x${string}` | undefined,
  enabled = true,
): IsolatedAccountRead {
  const calls: ContractCall[] = useMemo(
    () =>
      pair && dualOracle && account
        ? [
            ...STAMP_CALLS,
            { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "getUserSnapshot", args: [account] },
            { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "getPairAccounting" },
            { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "maxLTV" },
            { address: dualOracle, abi: DUAL_ORACLE_ABI, functionName: "getPrices" },
            { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "borrowLimit" },
          ]
        : [],
    [pair, dualOracle, account],
  );
  const query = useLuminaMulticall(calls, { enabled: enabled && calls.length > 0, policy: QUERY.user });
  const parsed = useMemo(() => parseIsolatedAccount(query.results), [query.results]);
  return {
    ...parsed,
    failed: query.isError === true,
    settled: query.results !== undefined || query.isError === true,
    refetch: query.refetch,
  };
}

// =============================================================================================
// Core liquidation: the borrower's position after the receipt
// =============================================================================================

export interface CoreBorrowerRead {
  healthFactor: bigint | undefined;
  /** Variable debt of the debt asset. */
  debt: bigint | undefined;
  /** aToken balance of the collateral asset. */
  collateral: bigint | undefined;
  stamp: BlockStamp | undefined;
  failed: boolean;
  settled: boolean;
  refetch: () => unknown;
}

/**
 * The borrower's HF, debt and collateral in one stamped multicall (spec §3.2: a liquidation's
 * success screen reads the borrower at or after the receipt block). Enabled only when asked.
 */
export function useCoreBorrowerRead(
  borrower: `0x${string}`,
  debtAsset: `0x${string}`,
  collateralAsset: `0x${string}`,
  enabled: boolean,
): CoreBorrowerRead {
  const pool = LUMINA.contracts.pool;
  const dataProvider = LUMINA.contracts.poolDataProvider;
  const calls: ContractCall[] = useMemo(
    () => [
      ...STAMP_CALLS,
      { address: pool, abi: POOL_ABI, functionName: "getUserAccountData", args: [borrower] },
      { address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getUserReserveData", args: [debtAsset, borrower] },
      { address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getUserReserveData", args: [collateralAsset, borrower] },
    ],
    [pool, dataProvider, borrower, debtAsset, collateralAsset],
  );
  const query = useLuminaMulticall(calls, { enabled, policy: QUERY.user });
  const r = query.results;
  const account = resultAt<readonly unknown[]>(r, 2);
  const debtReserve = resultAt<readonly unknown[]>(r, 3);
  const collateralReserve = resultAt<readonly unknown[]>(r, 4);
  return {
    // getUserAccountData()[5] = healthFactor; getUserReserveData()[2] = variable debt, [0] = aToken.
    healthFactor: account && typeof account[5] === "bigint" ? account[5] : undefined,
    debt: debtReserve && typeof debtReserve[2] === "bigint" ? debtReserve[2] : undefined,
    collateral: collateralReserve && typeof collateralReserve[0] === "bigint" ? collateralReserve[0] : undefined,
    stamp: readStamp(r),
    failed: query.isError === true,
    settled: r !== undefined || query.isError === true,
    refetch: query.refetch,
  };
}
