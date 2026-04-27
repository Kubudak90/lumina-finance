import { useReadContract, useReadContracts } from "wagmi";
import { ISOLATED_REGISTRY_ABI, ISOLATED_PAIR_ABI, ERC20_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";

export interface IsolatedPairInfo {
  pair: `0x${string}`;
  asset: `0x${string}`;
  collateral: `0x${string}`;
  assetSymbol: string;
  collateralSymbol: string;
  assetDecimals: number;
  collateralDecimals: number;
  maxLTV: bigint;        // basis points (0-100_000 → 0-100%)
  totalAssetAmount: bigint;
  totalBorrowAmount: bigint;
  utilization: number;
}

const LTV_PRECISION = 100_000n; // pair stores LTV as 1e5 basis (75_000 = 75%)

/**
 * Reads the list of pairs from the LightlendPairRegistry and per-pair stats.
 *
 * Returns minimal info to render a market list. For deeper per-pair detail
 * (interest rate, oracle prices, user snapshot) read directly from a single
 * pair address.
 */
export function useIsolatedPairs() {
  // 1. Pair list from registry
  const list = useReadContract({
    address: ADDRESSES.isolatedRegistry,
    abi: ISOLATED_REGISTRY_ABI,
    functionName: "getAllPairAddresses",
    query: { refetchInterval: 60_000 },
  });
  const pairs = (list.data as `0x${string}`[] | undefined) ?? [];

  // 2. For each pair: asset, collateral, maxLTV, totalAsset, totalBorrow
  const pairContracts = pairs.flatMap((p) => [
    { address: p, abi: ISOLATED_PAIR_ABI, functionName: "asset" as const },
    { address: p, abi: ISOLATED_PAIR_ABI, functionName: "collateralContract" as const },
    { address: p, abi: ISOLATED_PAIR_ABI, functionName: "maxLTV" as const },
    { address: p, abi: ISOLATED_PAIR_ABI, functionName: "totalAsset" as const },
    { address: p, abi: ISOLATED_PAIR_ABI, functionName: "totalBorrow" as const },
  ]);

  const pairResults = useReadContracts({
    contracts: pairContracts,
    query: { enabled: pairs.length > 0, refetchInterval: 30_000 },
  });

  // 3. Resolve token symbols/decimals — collected from per-pair token addresses
  const tokenAddresses = new Set<`0x${string}`>();
  if (pairResults.data) {
    for (let i = 0; i < pairs.length; i++) {
      const asset = pairResults.data[i * 5]?.result as `0x${string}` | undefined;
      const collateral = pairResults.data[i * 5 + 1]?.result as `0x${string}` | undefined;
      if (asset) tokenAddresses.add(asset);
      if (collateral) tokenAddresses.add(collateral);
    }
  }
  const tokenList = Array.from(tokenAddresses);
  const tokenContracts = tokenList.flatMap((t) => [
    { address: t, abi: ERC20_ABI, functionName: "symbol" as const },
    { address: t, abi: ERC20_ABI, functionName: "decimals" as const },
  ]);
  const tokenResults = useReadContracts({
    contracts: tokenContracts,
    query: { enabled: tokenList.length > 0 },
  });

  const tokenInfo: Record<string, { symbol: string; decimals: number }> = {};
  if (tokenResults.data) {
    for (let i = 0; i < tokenList.length; i++) {
      const sym = tokenResults.data[i * 2]?.result as string | undefined;
      const dec = tokenResults.data[i * 2 + 1]?.result as number | undefined;
      tokenInfo[tokenList[i].toLowerCase()] = {
        symbol: sym ?? "—",
        decimals: dec ?? 18,
      };
    }
  }

  const enriched: IsolatedPairInfo[] = pairs.map((p, i) => {
    const asset = (pairResults.data?.[i * 5]?.result as `0x${string}` | undefined) ?? ("0x0" as `0x${string}`);
    const collateral = (pairResults.data?.[i * 5 + 1]?.result as `0x${string}` | undefined) ?? ("0x0" as `0x${string}`);
    const maxLTV = (pairResults.data?.[i * 5 + 2]?.result as bigint | undefined) ?? 0n;
    const totalAssetTuple = pairResults.data?.[i * 5 + 3]?.result as readonly [bigint, bigint] | undefined;
    const totalBorrowTuple = pairResults.data?.[i * 5 + 4]?.result as readonly [bigint, bigint] | undefined;
    const totalAssetAmount = totalAssetTuple?.[0] ?? 0n;
    const totalBorrowAmount = totalBorrowTuple?.[0] ?? 0n;

    const aInfo = tokenInfo[asset.toLowerCase()] ?? { symbol: "—", decimals: 18 };
    const cInfo = tokenInfo[collateral.toLowerCase()] ?? { symbol: "—", decimals: 18 };

    return {
      pair: p,
      asset,
      collateral,
      assetSymbol: aInfo.symbol,
      collateralSymbol: cInfo.symbol,
      assetDecimals: aInfo.decimals,
      collateralDecimals: cInfo.decimals,
      maxLTV,
      totalAssetAmount,
      totalBorrowAmount,
      utilization:
        totalAssetAmount > 0n
          ? Number((totalBorrowAmount * 10000n) / totalAssetAmount) / 100
          : 0,
    };
  });

  return {
    pairs: enriched,
    isLoading: list.isLoading || pairResults.isLoading,
  };
}

export const ISOLATED_LTV_PRECISION = LTV_PRECISION;
