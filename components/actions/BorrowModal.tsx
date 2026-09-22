"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { safeParseUnits, isValidDecimalInput } from "@/lib/format";
import { txExplorerUrl } from "@/lib/explorer";
import { QUERY } from "@/lib/queryPolicy";
import { useAccount, useReadContract } from "wagmi";
import { useSimulatedWrite } from "@/hooks/useSimulatedWrite";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { POOL_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { formatHealthFactor } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getMarketByAsset } from "@/lib/constants";

interface BorrowModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function BorrowModal({ asset, symbol, decimals, onClose }: BorrowModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useSimulatedWrite();
  const { healthFactor } = useHealthFactor();

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;

  // Available liquidity — In Aave V3, underlying tokens are held by the aToken contract, not the Pool
  const market = getMarketByAsset(asset);
  const poolBalance = useReadContract({
    address: asset,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
    functionName: "balanceOf",
    args: market ? [market.aToken] : undefined,
    query: { enabled: !!market },
  });
  const availableLiquidity = (poolBalance.data as bigint) ?? 0n;
  const availableFormatted = formatUnits(availableLiquidity > 0n ? availableLiquidity : 0n, decimals);

  // User's borrowing power from getUserAccountData
  const accountDataResult = useReadContract({
    address: ADDRESSES.pool,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: address ? [address] : undefined,
    query: { enabled: !!address, ...QUERY.user },
  });

  let availableBorrowsBase = 0n;
  let totalCollateralBase = 0n;
  let totalDebtBase = 0n;
  let currentLiquidationThreshold = 0n;
  try {
    const d = accountDataResult.data as Record<string, bigint> | readonly bigint[] | undefined;
    if (d) {
      if (Array.isArray(d)) {
        totalCollateralBase = d[0] ?? 0n;
        totalDebtBase = d[1] ?? 0n;
        availableBorrowsBase = d[2] ?? 0n;
        currentLiquidationThreshold = d[3] ?? 0n;
      } else {
        const obj = d as Record<string, bigint>;
        totalCollateralBase = obj.totalCollateralBase ?? 0n;
        totalDebtBase = obj.totalDebtBase ?? 0n;
        availableBorrowsBase = obj.availableBorrowsBase ?? 0n;
        currentLiquidationThreshold = obj.currentLiquidationThreshold ?? 0n;
      }
    }
  } catch { /* ignore */ }

  // Get oracle price for the asset (8-decimal base units)
  const { data: oraclePrice } = useReadContract({
    address: ADDRESSES.oracle,
    abi: [{ name: "getAssetPrice", type: "function", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
    functionName: "getAssetPrice",
    args: [asset],
    query: { ...QUERY.user },
  });
  const priceRaw = (oraclePrice as bigint) ?? 0n;

  // Calculate max borrow based on health factor (not LTV) so the user can borrow
  // up to the liquidation threshold. Target HF = 1.05 for a safe margin.
  // Formula: maxNewDebt = (collateral * liqThreshold / 10000) / targetHF - existingDebt
  const DECIMALS_FACTOR_BORROW = 10n ** BigInt(decimals);
  const TARGET_HF_SCALED = 105n; // 1.05 * 100
  const collateralWeighted = totalCollateralBase * currentLiquidationThreshold / 10000n;
  const maxTotalDebtBase = TARGET_HF_SCALED > 0n ? (collateralWeighted * 100n) / TARGET_HF_SCALED : 0n;
  const maxNewDebtBase = maxTotalDebtBase > totalDebtBase ? maxTotalDebtBase - totalDebtBase : 0n;

  // Use the larger of HF-based and LTV-based capacity (HF-based is typically higher)
  const effectiveBorrowBase = maxNewDebtBase > availableBorrowsBase ? maxNewDebtBase : availableBorrowsBase;

  // Convert from base currency (8 decimals USD) to token amount
  const borrowCapTokensBigInt = priceRaw > 0n
    ? (effectiveBorrowBase * DECIMALS_FACTOR_BORROW) / priceRaw
    : 0n;
  const borrowCapTokens = Number(formatUnits(borrowCapTokensBigInt, decimals));
  const maxBorrowTokens = Math.min(borrowCapTokens, Number(availableFormatted));
  // Truncate to token's decimal precision to avoid parseUnits failure (e.g. USDC has 6 decimals)
  const maxDigits = decimals > 6 ? 6 : decimals;
  const maxBorrowFormatted = maxBorrowTokens > 0 ? maxBorrowTokens.toFixed(maxDigits) : "0";

  // Health factor helpers
  const isMaxHf = healthFactor === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

  // F-005: Simulate new health factor after borrow using BigInt arithmetic
  // HF = (totalCollateralBase * liqThreshold / 10000) / totalDebtBase
  // borrowValueInBase = parsedAmount * priceRaw / 10^decimals (both priceRaw and result in 8-decimal base)
  const DECIMALS_FACTOR = 10n ** BigInt(decimals);
  const borrowValueInBase = parsedAmount > 0n && priceRaw > 0n
    ? (parsedAmount * priceRaw) / DECIMALS_FACTOR
    : 0n;
  const newTotalDebt = totalDebtBase + borrowValueInBase;

  // Compute simulated HF as a bigint scaled by 1e18 for precision, then convert to Number only for display
  let simulatedHf: number | null = null;
  if (newTotalDebt > 0n && parsedAmount > 0n) {
    // simulatedHfScaled = collateralWeighted * 1e18 / newTotalDebt
    const HF_SCALE = 10n ** 18n;
    const simulatedHfScaled = (collateralWeighted * HF_SCALE) / newTotalDebt;
    simulatedHf = Number(simulatedHfScaled) / 1e18;
  }

  const simulatedHfColor = simulatedHf === null ? "text-muted-foreground"
    : simulatedHf >= 2 ? "text-emerald-400"
    : simulatedHf >= 1.2 ? "text-amber-400"
    : "text-red-400";

  // Error toast refs for repeated errors (F-012)
  const prevErrorRef = useRef<Error | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Borrow failed", {
        description: parseErrorMessage(error),
      });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Borrow successful", {
        description: "Transaction confirmed",
        action: {
          label: "View on Explorer",
          onClick: () => window.open(txExplorerUrl(hash), "_blank"),
        },
      });
    }
  }, [isSuccess, hash]);

  const handleBorrow = () => {
    if (!address) return;
    void send({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "borrow",
      args: [asset, parsedAmount, 2n, 0, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Borrow Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">You borrowed {amount} {symbol}</p>
            {hash && (
              <a
                href={txExplorerUrl(hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline font-mono"
              >
                View transaction
              </a>
            )}
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Borrow {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Borrow capacity info */}
              <div className="technical-border bg-background p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Borrow Capacity</span>
                  <span className="font-mono">{borrowCapTokens.toLocaleString("en-US", { maximumFractionDigits: 4 })} {symbol}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pool Liquidity</span>
                  <span className="font-mono">{Number(availableFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })} {symbol}</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Max: <span className="font-mono">{Math.min(borrowCapTokens, Number(availableFormatted)).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, decimals) && Number(v) >= 0)) setAmount(v); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setAmount(maxBorrowFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {parsedAmount > availableLiquidity && availableLiquidity > 0n && (
                  <p className="text-xs text-destructive mt-1">Amount exceeds available liquidity</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Ensure you have sufficient collateral. Health factor must remain above 1.05.</p>

              {/* Health Factor Simulation */}
              {healthFactor && (
                <div className="technical-border bg-background p-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <div className="flex items-center gap-2 font-mono font-medium">
                      <span>{formatHealthFactor(healthFactor)}</span>
                      {simulatedHf !== null && (
                        <>
                          <span className="text-muted-foreground">&rarr;</span>
                          <span className={simulatedHfColor}>{simulatedHf.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <HealthFactorBar healthFactor={healthFactor} />
                  {isMaxHf && (
                    <p className="text-xs text-muted-foreground">New borrower -- ensure you have collateral enabled</p>
                  )}
                  {simulatedHf !== null && simulatedHf < 1.0 && (
                    <p className="text-xs text-red-500 font-medium">
                      This borrow will put you below liquidation threshold. You will be liquidated immediately.
                    </p>
                  )}
                  {simulatedHf !== null && simulatedHf >= 1.0 && simulatedHf < 1.2 && (
                    <p className="text-xs text-red-500 font-medium">
                      Warning: Health factor will be critically low after this borrow. High liquidation risk.
                    </p>
                  )}
                  {simulatedHf !== null && simulatedHf >= 1.2 && simulatedHf < 1.5 && (
                    <p className="text-xs text-amber-500 font-medium">
                      Warning: Health factor will be low. Monitor your position closely.
                    </p>
                  )}
                  {simulatedHf !== null && simulatedHf >= 1.5 && (
                    <p className="text-xs text-muted-foreground">Position looks healthy after this borrow</p>
                  )}
                  {!isMaxHf && simulatedHf === null && (
                    <p className="text-xs text-muted-foreground">Enter an amount to see health factor impact</p>
                  )}
                </div>
              )}

              <TxButton
                onClick={handleBorrow}
                isPending={isPending}
                isSimulating={isSimulating}
                isConfirming={isConfirming}
                disabled={!address || !amount || parsedAmount === 0n || (availableLiquidity > 0n && parsedAmount > availableLiquidity) || (simulatedHf !== null && simulatedHf < 1.0)}
              >
                {simulatedHf !== null && simulatedHf < 1.0
                  ? "Health Factor Too Low"
                  : `Borrow ${symbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
