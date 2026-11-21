"use client";

import { useState, useMemo } from "react";
import { formatUnits } from "viem";
import { truncateAddress, MAX_HEALTH_FACTOR } from "@/lib/format";
import { useLuminaReadContract, useLuminaReadContracts } from "@/hooks/chain";
import { QUERY } from "@/lib/queryPolicy";
import { LiquidateModal } from "@/components/actions/LiquidateModal";
import { IsolatedLiquidateModal } from "@/components/actions/IsolatedLiquidateModal";
import { POOL_ABI, DATA_PROVIDER_ABI, ISOLATED_PAIR_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { MARKETS } from "@/lib/constants";
import { useIsolatedPairs, type IsolatedPairInfo } from "@/hooks/useIsolatedPairs";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { HEALTH_FACTOR_LIQUIDATION_THRESHOLD, maxLiquidatableDebt, type LiquidationLimit } from "@/lib/liquidation";
import { Badge } from "@/components/ui/badge";
import { TokenIcon } from "@/components/common/TokenIcon";

interface LiquidationOpportunity {
  key: string;
  borrower: `0x${string}`;
  debt: string;
  collateral: string;
  healthFactor: string;
  debtAsset: `0x${string}`;
  collateralAsset: `0x${string}`;
  debtSymbol: string;
  debtDecimals: number;
  collateralSymbol: string;
  collateralDecimals: number;
  /** The borrower's raw variable debt of the debt asset and aToken balance of the collateral. */
  rawDebt: bigint;
  rawCollateral: bigint;
  /** null when a price or reserve config is unavailable. */
  limit: LiquidationLimit | null;
}

interface IsolatedLiquidationOpportunity {
  borrower: `0x${string}`;
  pair: IsolatedPairInfo & { pair: `0x${string}` };
  /** undefined if the share → amount conversion failed. */
  borrowedAmount: bigint | undefined;
  borrowedShares: bigint;
  collateral: bigint;
}

export default function LiquidationsPage() {
  // The selected target is latched when its modal opens, so the modal stays mounted when the
  // borrower drops out of the live list (a liquidation that heals the borrower keeps its success
  // screen; spec ui-usability-v1 §3.2). While the target is in the live list, the modal gets its
  // live, polled data.
  const [selected, setSelected] = useState<LiquidationOpportunity | null>(null);
  const [selectedIsolated, setSelectedIsolated] = useState<IsolatedLiquidationOpportunity | null>(null);
  const [searchAddress, setSearchAddress] = useState("");
  const [checkAddress, setCheckAddress] = useState<`0x${string}` | undefined>();
  const { pairs: allPairs } = useIsolatedPairs();
  const isolatedPairs = useMemo(
    () => allPairs.filter((p): p is IsolatedPairInfo & { pair: `0x${string}` } => p.pair !== null),
    [allPairs],
  );
  const { priceOf } = useOraclePrices();
  const { getMarket } = useAllMarkets();
  const pool = LUMINA.contracts.pool;
  const dataProvider = LUMINA.contracts.poolDataProvider;

  const { data: accountData, isLoading: isLoadingHf, error: hfError } = useLuminaReadContract({
    address: pool ?? undefined,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: checkAddress ? [checkAddress] : undefined,
    query: { enabled: !!checkAddress && !!pool, ...QUERY.user },
  });

  const hf = accountData ? (accountData as readonly bigint[])[5] : undefined;

  // F-007: DataProvider.getUserReserveData gives the actual debt / collateral per asset
  const userReserveContracts = checkAddress && dataProvider
    ? MARKETS.map((m) => ({
        address: dataProvider,
        abi: DATA_PROVIDER_ABI,
        functionName: "getUserReserveData" as const,
        args: [m.asset, checkAddress] as const,
      }))
    : [];

  const userReserveResults = useLuminaReadContracts({
    contracts: userReserveContracts,
    query: { enabled: !!checkAddress && hf !== undefined && hf !== null, ...QUERY.user },
  });

  const opportunities: LiquidationOpportunity[] = [];
  if (checkAddress && hf !== undefined && hf !== null) {
    const hfBigInt = hf as bigint;
    if (hfBigInt < HEALTH_FACTOR_LIQUIDATION_THRESHOLD) {
      const hfFormatted = Number(formatUnits(hfBigInt, 18)).toFixed(4);
      const debtMarkets: { market: (typeof MARKETS)[number]; debt: bigint }[] = [];
      const collateralMarkets: { market: (typeof MARKETS)[number]; collateral: bigint }[] = [];

      MARKETS.forEach((m, i) => {
        const result = userReserveResults.data?.[i]?.result as readonly unknown[] | undefined;
        if (!result) return;
        // (currentATokenBalance, currentStableDebt, currentVariableDebt, …, usageAsCollateralEnabled)
        const aTokenBalance = typeof result[0] === "bigint" ? result[0] : 0n;
        const variableDebt = typeof result[2] === "bigint" ? result[2] : 0n;
        const usageAsCollateral = result[8] === true;
        if (variableDebt > 0n) debtMarkets.push({ market: m, debt: variableDebt });
        if (aTokenBalance > 0n && usageAsCollateral) collateralMarkets.push({ market: m, collateral: aTokenBalance });
      });

      for (const { market: debtMarket, debt } of debtMarkets) {
        for (const { market: collateralMarket, collateral } of collateralMarkets) {
          if (debtMarket.asset === collateralMarket.asset) continue;
          const debtPrice = priceOf(debtMarket.asset);
          const collateralPrice = priceOf(collateralMarket.asset);
          const bonus = getMarket(collateralMarket.asset)?.config?.liquidationBonus;
          // Close factor and collateral cap exactly as LiquidationLogic computes them (v3.2).
          const limit =
            debtPrice !== undefined && collateralPrice !== undefined && bonus !== undefined
              ? maxLiquidatableDebt({
                  healthFactor: hfBigInt,
                  userDebt: debt,
                  collateralBalance: collateral,
                  debtPrice,
                  collateralPrice,
                  debtDecimals: debtMarket.decimals,
                  collateralDecimals: collateralMarket.decimals,
                  liquidationBonus: BigInt(bonus),
                })
              : null;
          opportunities.push({
            key: `${debtMarket.asset}-${collateralMarket.asset}`,
            borrower: checkAddress,
            debt: `${Number(formatUnits(debt, debtMarket.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${debtMarket.symbol}`,
            collateral: `${Number(formatUnits(collateral, collateralMarket.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${collateralMarket.symbol}`,
            healthFactor: hfFormatted,
            debtAsset: debtMarket.asset,
            collateralAsset: collateralMarket.asset,
            debtSymbol: debtMarket.symbol,
            debtDecimals: debtMarket.decimals,
            collateralSymbol: collateralMarket.symbol,
            collateralDecimals: collateralMarket.decimals,
            rawDebt: debt,
            rawCollateral: collateral,
            limit,
          });
        }
      }
    }
  }
  const liveSelected = selected
    ? (opportunities.find((o) => o.key === selected.key && o.borrower.toLowerCase() === selected.borrower.toLowerCase()) ?? null)
    : null;
  const target = liveSelected ?? selected;
  const targetLimit = liveSelected?.limit ?? selected?.limit ?? null;

  // ─── Isolated pair lookup for the same searched address ───
  const isolatedSnapshotContracts = checkAddress
    ? isolatedPairs.map((p) => ({
        address: p.pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "getUserSnapshot" as const,
        args: [checkAddress] as const,
      }))
    : [];
  const isolatedSnapshots = useLuminaReadContracts({
    contracts: isolatedSnapshotContracts,
    query: { enabled: !!checkAddress && isolatedPairs.length > 0, ...QUERY.user },
  });

  const isolatedConvContracts = checkAddress && isolatedSnapshots.data
    ? isolatedPairs.map((p, i) => {
        const snap = isolatedSnapshots.data?.[i]?.result as readonly [bigint, bigint, bigint] | undefined;
        return {
          address: p.pair,
          abi: ISOLATED_PAIR_ABI,
          functionName: "toBorrowAmount" as const,
          args: [snap?.[1] ?? 0n, true, true] as const,
        };
      })
    : [];
  const isolatedConv = useLuminaReadContracts({
    contracts: isolatedConvContracts,
    query: { enabled: !!checkAddress && !!isolatedSnapshots.data, ...QUERY.user },
  });

  const isolatedOpportunities: IsolatedLiquidationOpportunity[] = useMemo(() => {
    if (!checkAddress) return [];
    return isolatedPairs
      .map((p, i) => {
        const snap = isolatedSnapshots.data?.[i]?.result as readonly [bigint, bigint, bigint] | undefined;
        const conv = isolatedConv.data?.[i];
        return {
          borrower: checkAddress,
          pair: p,
          borrowedShares: snap?.[1] ?? 0n,
          borrowedAmount: conv && conv.status === "success" ? (conv.result as bigint) : undefined,
          collateral: snap?.[2] ?? 0n,
        };
      })
      .filter((o) => o.borrowedShares > 0n);
  }, [checkAddress, isolatedPairs, isolatedSnapshots.data, isolatedConv.data]);
  const liveIsolated = selectedIsolated
    ? (isolatedOpportunities.find(
        (o) => o.pair.pair === selectedIsolated.pair.pair && o.borrower.toLowerCase() === selectedIsolated.borrower.toLowerCase(),
      ) ?? null)
    : null;
  const isolatedTarget = liveIsolated ?? selectedIsolated;

  const isValidAddress = (addr: string): addr is `0x${string}` => {
    return /^0x[0-9a-fA-F]{40}$/.test(addr);
  };

  const handleCheck = () => {
    if (isValidAddress(searchAddress)) {
      setCheckAddress(searchAddress as `0x${string}`);
    }
  };

  const hfDisplay = () => {
    if (!checkAddress) return null;
    if (isLoadingHf) return <p className="text-xs font-mono text-muted-foreground">Loading health factor...</p>;
    if (hfError) return <p className="text-xs font-mono text-destructive">Error reading health factor. Address may have no position.</p>;
    if (hf !== undefined && hf !== null) {
      const hfBigInt = hf as bigint;
      if (hfBigInt === MAX_HEALTH_FACTOR) {
        return <p className="text-xs font-mono text-green-500">Health Factor: Infinite (no debt)</p>;
      }
      const hfNum = Number(formatUnits(hfBigInt, 18));
      const isLiquidatable = hfBigInt < HEALTH_FACTOR_LIQUIDATION_THRESHOLD;
      return (
        <p className={`text-xs font-mono font-medium ${isLiquidatable ? "text-destructive" : "text-green-500"}`}>
          Health Factor: {hfNum.toFixed(4)} {isLiquidatable ? " -- LIQUIDATABLE" : " -- Healthy"}
        </p>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">Liquidations</h1>
        <p className="text-muted-foreground text-sm">Positions below health factor 1.0 can be liquidated</p>
      </div>

      {/* Search by address */}
      <div className="technical-border bg-card p-6 animate-in-delay-1">
        <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent mb-4">Check Address Health Factor</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            placeholder="0x... borrower address"
            className="h-12 text-sm font-mono flex-1 bg-background border border-border px-4 text-foreground placeholder:text-muted-foreground focus:border-accent/50 focus:outline-none transition-colors"
          />
          <button
            className="h-12 px-6 bg-accent text-background font-bold uppercase tracking-[0.2em] text-[10px] hover:bg-white shadow-[0_0_20px_rgba(176,196,255,0.2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleCheck}
            disabled={!isValidAddress(searchAddress)}
          >
            Check
          </button>
        </div>
        <div className="mt-3">
          {hfDisplay()}
        </div>
      </div>

      {/* Results table */}
      <div className="technical-border bg-card animate-in-delay-2">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Borrower</th>
              <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Debt</th>
              <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Collateral</th>
              <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Health Factor</th>
              <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground text-sm">
                  No liquidation opportunities found. Enter a borrower address above to check.
                </td>
              </tr>
            ) : (
              opportunities.map((o, i) => (
                <tr key={`${o.borrower}-${o.debtAsset}-${o.collateralAsset}-${i}`} className="border-b border-border/50 hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4 font-mono text-sm">{truncateAddress(o.borrower)}</td>
                  <td className="px-6 py-4 font-mono text-sm">{o.debt}</td>
                  <td className="px-6 py-4 font-mono text-sm">{o.collateral}</td>
                  <td className="px-6 py-4">
                    <Badge variant="destructive" className="font-mono">
                      {o.healthFactor}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      className="h-8 px-4 bg-destructive text-destructive-foreground text-[10px] font-mono uppercase tracking-wider hover:bg-destructive/80 transition-colors"
                      onClick={() => o.limit !== null && setSelected(o)}
                      disabled={o.limit === null}
                      title={o.limit === null ? "Price or reserve config unavailable" : undefined}
                    >
                      Liquidate
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Isolated pair liquidations */}
      <div className="technical-border bg-card animate-in-delay-3">
        <div className="p-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Isolated Pairs</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              Per-pair positions for the same address — pair reverts if borrower is solvent
            </p>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50">
              <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Pair</th>
              <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Borrowed</th>
              <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Collateral</th>
              <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {!checkAddress ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground text-xs">Enter a borrower address above to inspect isolated positions.</td></tr>
            ) : isolatedOpportunities.length === 0 ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground text-xs">No isolated debt for this address.</td></tr>
            ) : (
              isolatedOpportunities.map((o) => (
                <tr key={o.pair.pair} className="border-b border-border/50 hover:bg-white/5">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <TokenIcon symbol={o.pair.assetSymbol} size={20} />
                      <span className="text-muted-foreground">/</span>
                      <TokenIcon symbol={o.pair.collateralSymbol} size={20} />
                      <span className="font-mono text-sm ml-2">{o.pair.assetSymbol}/{o.pair.collateralSymbol}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 font-mono text-sm text-right">
                    {o.borrowedAmount === undefined ? "unavailable" : `${Number(formatUnits(o.borrowedAmount, o.pair.assetDecimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${o.pair.assetSymbol}`}
                  </td>
                  <td className="px-6 py-4 font-mono text-sm text-right">
                    {Number(formatUnits(o.collateral, o.pair.collateralDecimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })} {o.pair.collateralSymbol}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => setSelectedIsolated(o)}
                      className="h-8 px-4 bg-destructive text-destructive-foreground text-[10px] font-mono uppercase tracking-wider hover:bg-destructive/80 transition-colors"
                    >
                      Liquidate
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {target && targetLimit && (
        <LiquidateModal
          borrower={target.borrower}
          debtAsset={target.debtAsset}
          debtSymbol={target.debtSymbol}
          debtDecimals={target.debtDecimals}
          collateralAsset={target.collateralAsset}
          collateralSymbol={target.collateralSymbol}
          collateralDecimals={target.collateralDecimals}
          borrowerDebt={target.rawDebt}
          borrowerCollateral={target.rawCollateral}
          maxDebt={targetLimit.maxDebtToCover}
          closeFactorBps={targetLimit.closeFactor}
          collateralLimited={targetLimit.collateralLimited}
          liquidatable={liveSelected !== null}
          onClose={() => setSelected(null)}
        />
      )}
      {isolatedTarget && (
        <IsolatedLiquidateModal
          pair={isolatedTarget.pair.pair}
          asset={isolatedTarget.pair.asset}
          assetSymbol={isolatedTarget.pair.assetSymbol}
          assetDecimals={isolatedTarget.pair.assetDecimals}
          collateralSymbol={isolatedTarget.pair.collateralSymbol}
          collateralDecimals={isolatedTarget.pair.collateralDecimals}
          borrower={isolatedTarget.borrower}
          borrowerDebtAsset={isolatedTarget.borrowedAmount}
          borrowerDebtShares={isolatedTarget.borrowedShares}
          borrowerCollateral={isolatedTarget.collateral}
          dualOracle={isolatedTarget.pair.dualOracle}
          liquidatable={liveIsolated !== null}
          onClose={() => setSelectedIsolated(null)}
        />
      )}
    </div>
  );
}
