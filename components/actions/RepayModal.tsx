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
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { POOL_ABI, ERC20_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { formatHealthFactor } from "@/lib/format";
import { getMarketByAsset } from "@/lib/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface RepayModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function RepayModal({ asset, symbol, decimals, onClose }: RepayModalProps) {
  const [amount, setAmount] = useState("");
  const [pendingRepayAfterApproval, setPendingRepayAfterApproval] = useState(false);
  const approvedAmountRef = useRef<bigint>(0n);
  const { address } = useAccount();
  const approval = useTokenApproval(asset, ADDRESSES.pool, address);
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useSimulatedWrite();

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;

  const market = getMarketByAsset(asset);
  const { healthFactor } = useHealthFactor();

  // Wallet balance
  const walletBalanceResult = useReadContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const wallet = (walletBalanceResult.data as bigint) ?? 0n;
  const walletFormatted = formatUnits(wallet, decimals);

  // Debt balance - also read from getUserAccountData for cross-check
  const debtBalanceResult = useReadContract({
    address: market?.variableDebtToken,
    abi: VARIABLE_DEBT_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!market, ...QUERY.user },
  });
  const debtFromToken = (debtBalanceResult.data as bigint) ?? 0n;

  // Also check via getUserAccountData for total debt (in case debtToken read fails)
  const accountResult = useReadContract({
    address: ADDRESSES.pool,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: address ? [address] : undefined,
    query: { enabled: !!address, ...QUERY.user },
  });
  let totalDebtBase = 0n;
  try {
    const d = accountResult.data as Record<string, bigint> | readonly bigint[] | undefined;
    if (d) {
      totalDebtBase = Array.isArray(d) ? (d[1] ?? 0n) : ((d as Record<string, bigint>).totalDebtBase ?? 0n);
    }
  } catch { /* ignore */ }

  // Use debtToken balance if available, otherwise show totalDebtBase info
  const debt = debtFromToken;
  const debtFormatted = formatUnits(debt, decimals);
  const hasTotalDebt = totalDebtBase > 0n;

  // Max repay = min(wallet, debt)
  const maxRepay = wallet < debt ? wallet : debt;
  const maxRepayFormatted = formatUnits(maxRepay, decimals);

  // Error toast refs for repeated errors (F-012)
  const prevErrorRef = useRef<Error | null>(null);
  const prevApprovalErrorRef = useRef<Error | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Repayment failed", {
        description: parseErrorMessage(error),
      });
    }
  }, [error]);

  useEffect(() => {
    if (approval.error && approval.error !== prevApprovalErrorRef.current) {
      prevApprovalErrorRef.current = approval.error;
      toast.error("Approval failed", {
        description: parseErrorMessage(approval.error),
      });
    }
  }, [approval.error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Repayment successful", {
        description: "Transaction confirmed",
        action: {
          label: "View on Explorer",
          onClick: () => window.open(txExplorerUrl(hash), "_blank"),
        },
      });
    }
  }, [isSuccess, hash]);

  // Reset pending state when amount changes to prevent stale auto-repay
  useEffect(() => {
    setPendingRepayAfterApproval(false);
  }, [amount]);

  // Auto-proceed with repay after approval succeeds
  useEffect(() => {
    if (approval.isSuccess && pendingRepayAfterApproval) {
      setPendingRepayAfterApproval(false);
      if (!address) return;
      void send({
        address: ADDRESSES.pool,
        abi: POOL_ABI,
        functionName: "repay",
        args: [asset, approvedAmountRef.current, 2n, address],
      });
    }
  }, [approval.isSuccess, pendingRepayAfterApproval, address, asset, send]);

  const handleRepay = () => {
    if (!address) return;
    if (approval.needsApproval(parsedAmount)) {
      approvedAmountRef.current = parsedAmount;
      approval.approve(parsedAmount);
      setPendingRepayAfterApproval(true);
      return;
    }
    void send({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "repay",
      args: [asset, parsedAmount, 2n, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Repayment Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">You repaid {amount} {symbol}</p>
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
              <DialogTitle>Repay {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Balance info */}
              <div className="technical-border bg-background p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{symbol} Debt</span>
                  <span className="font-mono">{Number(debtFormatted).toLocaleString("en-US", { maximumFractionDigits: 6 })} {symbol}</span>
                </div>
                {hasTotalDebt && debt === 0n && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Debt (USD)</span>
                    <span className="font-mono text-amber-400">${(Number(totalDebtBase) / 1e8).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Wallet</span>
                  <span className="font-mono">{Number(walletFormatted).toLocaleString("en-US", { maximumFractionDigits: 6 })} {symbol}</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Max: <span className="font-mono">{Number(maxRepayFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
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
                    onClick={() => setAmount(maxRepayFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {parsedAmount > wallet && (
                  <p className="text-xs text-destructive mt-1">Insufficient wallet balance</p>
                )}
                {parsedAmount > debt && parsedAmount <= wallet && (
                  <p className="text-xs text-amber-500 mt-1">Amount exceeds your debt</p>
                )}
              </div>

              {/* Health Factor */}
              {healthFactor && (
                <div className="technical-border bg-background p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <span className="font-mono font-medium">{formatHealthFactor(healthFactor)}</span>
                  </div>
                  <p className="text-xs text-emerald-400">Repaying improves your health factor</p>
                </div>
              )}

              <TxButton
                onClick={handleRepay}
                isPending={isPending || approval.isPending}
                isSimulating={isSimulating || approval.isSimulating}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!address || !amount || parsedAmount === 0n || parsedAmount > wallet}
              >
                {approval.needsApproval(parsedAmount) ? `Approve ${symbol}` : `Repay ${symbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
