"use client";

import { useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { truncateAddress } from "@/lib/format";
import { LiquidateModal } from "@/components/actions/LiquidateModal";
import { POOL_ABI, DATA_PROVIDER_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";

interface LiquidationOpportunity {
  borrower: `0x${string}`;
  debt: string;
  collateral: string;
  healthFactor: string;
  debtAsset: `0x${string}`;
  collateralAsset: `0x${string}`;
  maxDebt: string;
  debtSymbol: string;
  debtDecimals: number;
}

export default function LiquidationsPage() {
  const [selected, setSelected] = useState<LiquidationOpportunity | null>(null);
  const [searchAddress, setSearchAddress] = useState("");
  const [checkAddress, setCheckAddress] = useState<`0x${string}` | undefined>();

  const { data: accountData, isLoading: isLoadingHf, error: hfError } = useReadContract({
    address: ADDRESSES.pool,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: checkAddress ? [checkAddress] : undefined,
    query: { enabled: !!checkAddress },
  });

  const hf = accountData ? (accountData as readonly bigint[])[5] : undefined;

  // F-007: Use DataProvider.getUserReserveData to determine actual debt/collateral per address
  const userReserveContracts = checkAddress
    ? MARKETS.map((m) => ({
        address: ADDRESSES.dataProvider as `0x${string}`,
        abi: DATA_PROVIDER_ABI,
        functionName: "getUserReserveData" as const,
        args: [m.asset, checkAddress] as const,
      }))
    : [];

  const userReserveResults = useReadContracts({
    contracts: userReserveContracts,
    query: { enabled: !!checkAddress && hf !== undefined && hf !== null },
  });

  const opportunities: LiquidationOpportunity[] = [];
  if (checkAddress && hf !== undefined && hf !== null) {
    const hfBigInt = hf as bigint;
    if (hfBigInt < BigInt("1000000000000000000")) {
      const hfFormatted = Number(formatUnits(hfBigInt, 18)).toFixed(4);

      // Parse user reserve data to find actual debt and collateral positions
      const debtMarkets: { market: typeof MARKETS[number]; debt: bigint }[] = [];
      const collateralMarkets: { market: typeof MARKETS[number]; collateral: bigint }[] = [];

      MARKETS.forEach((m, i) => {
        const result = userReserveResults.data?.[i]?.result;
        if (!result) return;

        try {
          let currentATokenBalance = 0n;
          let currentVariableDebt = 0n;
          let currentStableDebt = 0n;
          let usageAsCollateralEnabled = false;

          if (Array.isArray(result)) {
            currentATokenBalance = (result[0] as bigint) ?? 0n;
            currentStableDebt = (result[1] as bigint) ?? 0n;
            currentVariableDebt = (result[2] as bigint) ?? 0n;
            usageAsCollateralEnabled = (result[8] as boolean) ?? false;
          } else {
            const obj = result as unknown as Record<string, unknown>;
            currentATokenBalance = (obj.currentATokenBalance as bigint) ?? 0n;
            currentStableDebt = (obj.currentStableDebt as bigint) ?? 0n;
            currentVariableDebt = (obj.currentVariableDebt as bigint) ?? 0n;
            usageAsCollateralEnabled = (obj.usageAsCollateralEnabled as boolean) ?? false;
          }

          const totalDebt = currentStableDebt + currentVariableDebt;
          if (totalDebt > 0n) {
            debtMarkets.push({ market: m, debt: totalDebt });
          }
          if (currentATokenBalance > 0n && usageAsCollateralEnabled) {
            collateralMarkets.push({ market: m, collateral: currentATokenBalance });
          }
        } catch { /* ignore parse errors */ }
      });

      // Only show valid opportunities: actual debt paired with actual collateral
      for (const { market: debtMarket, debt } of debtMarkets) {
        for (const { market: collateralMarket, collateral } of collateralMarkets) {
          if (debtMarket.asset === collateralMarket.asset) continue;
          const debtFormatted = formatUnits(debt, debtMarket.decimals);
          // F-006: Max liquidatable = 50% close factor
          const maxDebtAmount = debt / 2n;
          const maxDebtFormatted = formatUnits(maxDebtAmount, debtMarket.decimals);
          opportunities.push({
            borrower: checkAddress,
            debt: `${Number(debtFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${debtMarket.symbol}`,
            collateral: `${Number(formatUnits(collateral, collateralMarket.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${collateralMarket.symbol}`,
            healthFactor: hfFormatted,
            debtAsset: debtMarket.asset,
            collateralAsset: collateralMarket.asset,
            maxDebt: maxDebtFormatted,
            debtSymbol: debtMarket.symbol,
            debtDecimals: debtMarket.decimals,
          });
        }
      }
    }
  }

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
      if (hfBigInt === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) {
        return <p className="text-xs font-mono text-green-500">Health Factor: Infinite (no debt)</p>;
      }
      const hfNum = Number(formatUnits(hfBigInt, 18));
      const isLiquidatable = hfBigInt < BigInt("1000000000000000000");
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
                      onClick={() => setSelected(o)}
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

      {selected && (
        <LiquidateModal
          borrower={selected.borrower}
          debtAsset={selected.debtAsset}
          debtSymbol={selected.debtSymbol}
          collateralAsset={selected.collateralAsset}
          maxDebt={selected.maxDebt}
          debtDecimals={selected.debtDecimals}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
