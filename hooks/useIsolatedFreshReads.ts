"use client";

import { useCallback } from "react";
import { DUAL_ORACLE_ABI, ERC20_ABI, ISOLATED_PAIR_ABI, PRICE_GUARD_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import type { VaultTotals } from "@/lib/approvals";
import { bigintAt, resultAt, useLuminaReader } from "@/hooks/chain";

export interface FreshAccountState {
  /** getUserSnapshot(account): [assetShares, borrowShares, collateral]. */
  assetShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
  /** ERC-20 allowance of `owner` to the pair, and the owner's wallet balance, of `token`. */
  allowance: bigint;
  wallet: bigint;
}

export interface FreshPairRisk {
  /** Pair oracle rate (priceHigh) and its bad-data flag. */
  exchangeRate: bigint;
  /** Pair oracle low rate (priceLow), used by liquidate(). */
  lowExchangeRate: bigint;
  oracleBadData: boolean;
  /** LuminaPriceGuard.borrowStatus() == OK. */
  guardOk: boolean;
  maxLtv: bigint;
  totalAssetAmount: bigint;
  totalBorrowAmount: bigint;
  totalBorrowShares: bigint;
  borrowLimit: bigint;
}

export interface FreshLiquidationContext {
  borrowShares: bigint;
  collateral: bigint;
  allowance: bigint;
  wallet: bigint;
  /** Pair liquidation exchange rate (priceLow). */
  lowExchangeRate: bigint;
  maxLtv: bigint;
  totalBorrow: VaultTotals;
  cleanLiquidationFee: bigint;
  dirtyLiquidationFee: bigint;
  protocolLiquidationFee: bigint;
}

/**
 * Reads straight from the chain (not the poll cache) for the checks an isolated follow-up makes
 * right before it sends (Gemini r2 M3). Every function throws if a read fails: the caller then
 * sends nothing.
 */
export function useIsolatedFreshReads() {
  const read = useLuminaReader();

  /** Snapshot of `account` in `pair`, plus allowance (owner → pair) and wallet of `token`. */
  const accountState = useCallback(
    async (pair: `0x${string}`, account: `0x${string}`, token: `0x${string}`, owner: `0x${string}`): Promise<FreshAccountState> => {
      const r = await read([
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "getUserSnapshot", args: [account] },
        { address: token, abi: ERC20_ABI, functionName: "allowance", args: [owner, pair] },
        { address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [owner] },
      ]);
      const snap = resultAt<readonly bigint[]>(r, 0);
      const allowance = bigintAt(r, 1);
      const wallet = bigintAt(r, 2);
      if (!snap || snap.length < 3 || allowance === undefined || wallet === undefined) {
        throw new Error("could not read the position, allowance or wallet from the chain");
      }
      return { assetShares: snap[0], borrowShares: snap[1], collateral: snap[2], allowance, wallet };
    },
    [read],
  );

  /** toBorrowAmount(shares, roundUp = true, previewInterest = true): the value the pair will pull. */
  const shareValue = useCallback(
    async (pair: `0x${string}`, shares: bigint): Promise<bigint> => {
      if (shares === 0n) return 0n;
      const value = bigintAt(
        await read([{ address: pair, abi: ISOLATED_PAIR_ABI, functionName: "toBorrowAmount", args: [shares, true, true] }]),
        0,
      );
      if (value === undefined) throw new Error("could not read the share value from the chain");
      return value;
    },
    [read],
  );

  /** Pair rate, oracle flag, guard status and limits. */
  const pairRisk = useCallback(
    async (pair: `0x${string}`, dualOracle: `0x${string}` | null): Promise<FreshPairRisk> => {
      const guard = LUMINA.contracts.priceGuard;
      if (!dualOracle || !guard) throw new Error("pair oracle or guard not in the manifest");
      const r = await read([
        { address: dualOracle, abi: DUAL_ORACLE_ABI, functionName: "getPrices" },
        { address: guard, abi: PRICE_GUARD_ABI, functionName: "borrowStatus" },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "maxLTV" },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "getPairAccounting" },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "borrowLimit" },
      ]);
      const prices = resultAt<readonly [boolean, bigint, bigint]>(r, 0);
      const status = resultAt<readonly [number, number]>(r, 1);
      const maxLtv = bigintAt(r, 2);
      const accounting = resultAt<readonly bigint[]>(r, 3);
      const borrowLimit = bigintAt(r, 4);
      if (!prices || !status || maxLtv === undefined || !accounting || borrowLimit === undefined) {
        throw new Error("could not read the pair's rate, guard or limits from the chain");
      }
      return {
        exchangeRate: prices[2],
        lowExchangeRate: prices[1],
        oracleBadData: prices[0],
        guardOk: Number(status[0]) === 0,
        maxLtv,
        totalAssetAmount: accounting[0],
        totalBorrowAmount: accounting[2],
        totalBorrowShares: accounting[3],
        borrowLimit,
      };
    },
    [read],
  );

  /** Atomic single-block read for isolated pair liquidation pre-send checks (F8). */
  const liquidationContext = useCallback(
    async (
      pair: `0x${string}`,
      borrower: `0x${string}`,
      asset: `0x${string}`,
      liquidator: `0x${string}`,
      dualOracle: `0x${string}` | null,
    ): Promise<FreshLiquidationContext> => {
      if (!dualOracle) throw new Error("pair oracle not in the manifest");
      const r = await read([
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "getUserSnapshot", args: [borrower] },
        { address: asset, abi: ERC20_ABI, functionName: "allowance", args: [liquidator, pair] },
        { address: asset, abi: ERC20_ABI, functionName: "balanceOf", args: [liquidator] },
        { address: dualOracle, abi: DUAL_ORACLE_ABI, functionName: "getPrices" },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "maxLTV" },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "getPairAccounting" },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "cleanLiquidationFee" },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "dirtyLiquidationFee" },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "protocolLiquidationFee" },
      ]);
      const snap = resultAt<readonly bigint[]>(r, 0);
      const allowance = bigintAt(r, 1);
      const wallet = bigintAt(r, 2);
      const prices = resultAt<readonly [boolean, bigint, bigint]>(r, 3);
      const maxLtv = bigintAt(r, 4);
      const accounting = resultAt<readonly bigint[]>(r, 5);
      const cleanLiquidationFee = bigintAt(r, 6);
      const dirtyLiquidationFee = bigintAt(r, 7);
      const protocolLiquidationFee = bigintAt(r, 8);
      if (
        !snap ||
        snap.length < 3 ||
        allowance === undefined ||
        wallet === undefined ||
        !prices ||
        typeof prices[1] !== "bigint" ||
        prices[1] <= 0n ||
        maxLtv === undefined ||
        !accounting ||
        accounting.length < 4 ||
        cleanLiquidationFee === undefined ||
        dirtyLiquidationFee === undefined ||
        protocolLiquidationFee === undefined
      ) {
        throw new Error("could not read the borrower, rate or liquidation fees from the chain");
      }
      return {
        borrowShares: snap[1],
        collateral: snap[2],
        allowance,
        wallet,
        lowExchangeRate: prices[1],
        maxLtv,
        totalBorrow: { amount: accounting[2], shares: accounting[3] },
        cleanLiquidationFee,
        dirtyLiquidationFee,
        protocolLiquidationFee,
      };
    },
    [read],
  );

  return { accountState, shareValue, pairRisk, liquidationContext };
}
