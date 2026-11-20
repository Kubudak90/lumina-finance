"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { ATOKEN_ABI, DATA_PROVIDER_ABI, POOL_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { LUMINA } from "@/lib/deployments";
import { safeBigInt } from "@/lib/format";
import { resultAt, useLuminaMulticall, type ContractCall } from "@/hooks/chain";
import { STAMP_CALLS, STAMP_OFFSET, readStamp } from "@/hooks/useBlockStamp";

export interface UserMarketPosition {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  /** aToken balance (supplied incl. interest). */
  supplied: bigint;
  /** variable debt token balance (debt incl. interest). */
  borrowed: bigint;
  /** Supplied amount counted as collateral (0 when collateral is disabled). */
  collateral: bigint;
  collateralEnabled: boolean;
}

export interface UserAccountData {
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  currentLiquidationThreshold: bigint;
  ltv: bigint;
  healthFactor: bigint;
}

const CALLS_PER_MARKET = 3;
const ACCOUNT_INDEX = STAMP_OFFSET;
const MARKETS_OFFSET = STAMP_OFFSET + 1;

/**
 * The connected user's core position in ONE multicall: account data (HF), per-market aToken and
 * debt balances and collateral flags, plus the block they were read at. Polled every 15 s
 * (FE-07). Token addresses come from the manifest.
 */
export function useUserPosition() {
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const dataProvider = LUMINA.contracts.poolDataProvider;

  const calls: ContractCall[] = useMemo(() => {
    if (!address) return [];
    return [
      ...STAMP_CALLS,
      { address: pool, abi: POOL_ABI, functionName: "getUserAccountData", args: [address] },
      ...LUMINA.coreMarkets.flatMap((m) => [
        { address: m.aToken, abi: ATOKEN_ABI, functionName: "balanceOf", args: [address] },
        { address: m.variableDebtToken, abi: VARIABLE_DEBT_TOKEN_ABI, functionName: "balanceOf", args: [address] },
        { address: dataProvider, abi: DATA_PROVIDER_ABI, functionName: "getUserReserveData", args: [m.asset, address] },
      ]),
    ];
  }, [address, pool, dataProvider]);

  const query = useLuminaMulticall(calls, { enabled: !!address, policy: QUERY.user });
  const results = query.results;

  const accountData: UserAccountData | undefined = useMemo(() => {
    const d = resultAt<readonly unknown[]>(results, ACCOUNT_INDEX);
    if (!d) return undefined;
    return {
      totalCollateralBase: safeBigInt(d[0]),
      totalDebtBase: safeBigInt(d[1]),
      availableBorrowsBase: safeBigInt(d[2]),
      currentLiquidationThreshold: safeBigInt(d[3]),
      ltv: safeBigInt(d[4]),
      healthFactor: safeBigInt(d[5]),
    };
  }, [results]);

  const positions: UserMarketPosition[] = useMemo(
    () =>
      LUMINA.coreMarkets.map((m, i) => {
        const base = MARKETS_OFFSET + i * CALLS_PER_MARKET;
        const supplied = safeBigInt(resultAt(results, base));
        const borrowed = safeBigInt(resultAt(results, base + 1));
        // getUserReserveData(...)[8] = usageAsCollateralEnabled
        const reserve = resultAt<readonly unknown[]>(results, base + 2);
        const collateralEnabled = reserve ? reserve[8] === true : false;
        return {
          asset: m.asset,
          symbol: m.symbol,
          decimals: m.decimals,
          supplied,
          borrowed,
          collateral: collateralEnabled ? supplied : 0n,
          collateralEnabled,
        };
      }),
    [results],
  );

  return {
    positions,
    accountData,
    stamp: readStamp(results),
    isLoading: !!address && query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    isConnected: !!address,
  };
}
