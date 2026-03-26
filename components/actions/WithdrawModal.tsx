"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { safeParseUnits, isValidDecimalInput } from "@/lib/format";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { POOL_ABI, ATOKEN_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { formatHealthFactor } from "@/lib/format";
import { getMarketByAsset } from "@/lib/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface WithdrawModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function WithdrawModal({ asset, symbol, decimals, onClose }: WithdrawModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;

  const market = getMarketByAsset(asset);
  const { healthFactor } = useHealthFactor();

  // Supplied balance (aToken balance)
  const suppliedBalance = useReadContract({
    address: market?.aToken,
    abi: ATOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!market },
  });
  const supplied = (suppliedBalance.data as bigint) ?? 0n;
  const suppliedFormatted = formatUnits(supplied, decimals);

  // Health factor helpers
  const isMaxHf = healthFactor === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

  // F-015: Simulate post-withdrawal health factor using BigInt arithmetic
  // Read user account data for simulation
  const accountDataResult = useReadContract({
    address: ADDRESSES.pool,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const oraclePriceResult = useReadContract({
    address: ADDRESSES.oracle,
    abi: [{ name: "getAssetPrice", type: "function", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
    functionName: "getAssetPrice",
    args: [asset],
  });

  let totalCollateralBase = 0n;
  let totalDebtBase = 0n;
  let currentLiquidationThreshold = 0n;
  try {
    const d = accountDataResult.data as Record<string, bigint> | readonly bigint[] | undefined;
    if (d) {
      if (Array.isArray(d)) {
        totalCollateralBase = d[0] ?? 0n;
        totalDebtBase = d[1] ?? 0n;
        currentLiquidationThreshold = d[3] ?? 0n;
      } else {
        const obj = d as Record<string, bigint>;
        totalCollateralBase = obj.totalCollateralBase ?? 0n;
        totalDebtBase = obj.totalDebtBase ?? 0n;
        currentLiquidationThreshold = obj.currentLiquidationThreshold ?? 0n;
      }
    }
  } catch { /* ignore */ }

  const priceRaw = (oraclePriceResult.data as bigint) ?? 0n;
  const DECIMALS_FACTOR = 10n ** BigInt(decimals);
  const withdrawValueInBase = parsedAmount > 0n && priceRaw > 0n
    ? (parsedAmount * priceRaw) / DECIMALS_FACTOR
    : 0n;
  const newTotalCollateral = totalCollateralBase > withdrawValueInBase
    ? totalCollateralBase - withdrawValueInBase
    : 0n;
  const collateralWeighted = newTotalCollateral * currentLiquidationThreshold / 10000n;

  let simulatedHf: number | null = null;
  if (totalDebtBase > 0n && parsedAmount > 0n) {
    const HF_SCALE = 10n ** 18n;
    const simulatedHfScaled = (collateralWeighted * HF_SCALE) / totalDebtBase;
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
      toast.error("Withdrawal failed", {
        description: parseErrorMessage(error),
      });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Withdrawal successful", {
        description: "Transaction confirmed",
        action: {
          label: "View on Explorer",
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank"),
        },
      });
    }
  }, [isSuccess, hash]);

  const handleWithdraw = () => {
    if (!address) return;
    writeContract({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "withdraw",
      args: [asset, parsedAmount, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Withdrawal Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">You withdrew {amount} {symbol}</p>
            {hash && (
              <a
                href={`https://sepolia.basescan.org/tx/${hash}`}
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
              <DialogTitle>Withdraw {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Supplied: <span className="font-mono">{Number(suppliedFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
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
                    onClick={() => setAmount(suppliedFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {parsedAmount > supplied && (
                  <p className="text-xs text-destructive mt-1">Amount exceeds supplied balance</p>
                )}
              </div>

              {/* Health Factor with simulation */}
              {healthFactor && (
                <div className="technical-border bg-background p-3 space-y-1.5">
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
                  {simulatedHf !== null && simulatedHf < 1.0 && (
                    <p className="text-xs text-red-500 font-medium">
                      This withdrawal will put you below liquidation threshold.
                    </p>
                  )}
                  {simulatedHf !== null && simulatedHf >= 1.0 && simulatedHf < 1.5 && (
                    <p className="text-xs text-amber-500 font-medium">
                      Warning: Withdrawing may lower your health factor and increase liquidation risk.
                    </p>
                  )}
                  {simulatedHf !== null && simulatedHf >= 1.5 && (
                    <p className="text-xs text-muted-foreground">Withdrawing reduces your health factor</p>
                  )}
                  {!isMaxHf && simulatedHf === null && (
                    <p className="text-xs text-muted-foreground">Enter an amount to see health factor impact</p>
                  )}
                  {isMaxHf && (
                    <p className="text-xs text-muted-foreground">No debt -- withdrawal is safe</p>
                  )}
                </div>
              )}

              <TxButton
                onClick={handleWithdraw}
                isPending={isPending}
                isConfirming={isConfirming}
                disabled={!address || !amount || parsedAmount === 0n || parsedAmount > supplied}
              >
                Withdraw {symbol}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
