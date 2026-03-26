"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { safeParseUnits, isValidDecimalInput } from "@/lib/format";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { POOL_ABI, ERC20_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { parseErrorMessage } from "@/lib/errorMessages";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface LiquidateModalProps {
  borrower: `0x${string}`;
  debtAsset: `0x${string}`;
  debtSymbol: string;
  collateralAsset: `0x${string}`;
  maxDebt: string;
  debtDecimals: number;
  onClose: () => void;
}

export function LiquidateModal({
  borrower,
  debtAsset,
  debtSymbol,
  collateralAsset,
  maxDebt,
  debtDecimals,
  onClose,
}: LiquidateModalProps) {
  const [amount, setAmount] = useState("");
  const [pendingLiquidateAfterApproval, setPendingLiquidateAfterApproval] = useState(false);
  const approvedAmountRef = useRef<bigint>(0n);
  const { address } = useAccount();
  const approval = useTokenApproval(debtAsset, ADDRESSES.pool, address);
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsedAmount = amount ? (safeParseUnits(amount, debtDecimals) ?? 0n) : 0n;

  // F-006: Compute max liquidatable amount (50% close factor)
  const maxDebtParsed = safeParseUnits(maxDebt, debtDecimals) ?? 0n;
  const maxLiquidatable = maxDebtParsed / 2n; // 50% close factor
  const exceedsMax = parsedAmount > 0n && maxLiquidatable > 0n && parsedAmount > maxLiquidatable;

  // F-008: Check wallet balance of debt token
  const walletBalanceResult = useReadContract({
    address: debtAsset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const walletBalance = (walletBalanceResult.data as bigint) ?? 0n;
  const insufficientBalance = parsedAmount > 0n && parsedAmount > walletBalance;

  // Error toast refs for repeated errors (F-012)
  const prevErrorRef = useRef<Error | null>(null);
  const prevApprovalErrorRef = useRef<Error | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Liquidation failed", {
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
      toast.success("Liquidation successful", {
        description: "Transaction confirmed",
        action: {
          label: "View on Explorer",
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank"),
        },
      });
    }
  }, [isSuccess, hash]);

  // Reset pending state when amount changes to prevent stale auto-liquidate
  useEffect(() => {
    setPendingLiquidateAfterApproval(false);
  }, [amount]);

  // Auto-proceed with liquidation after approval succeeds
  useEffect(() => {
    if (approval.isSuccess && pendingLiquidateAfterApproval) {
      setPendingLiquidateAfterApproval(false);
      writeContract({
        address: ADDRESSES.pool,
        abi: POOL_ABI,
        functionName: "liquidationCall",
        args: [collateralAsset, debtAsset, borrower, approvedAmountRef.current, false],
      });
    }
  }, [approval.isSuccess, pendingLiquidateAfterApproval]);

  const handleLiquidate = () => {
    if (approval.needsApproval(parsedAmount)) {
      approvedAmountRef.current = parsedAmount;
      approval.approve(parsedAmount);
      setPendingLiquidateAfterApproval(true);
      return;
    }
    // Aave V3: liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken)
    writeContract({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "liquidationCall",
      args: [collateralAsset, debtAsset, borrower, parsedAmount, false],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Liquidation Successful</DialogTitle>
            </DialogHeader>
            {hash && (
              <a
                href={`https://sepolia.basescan.org/tx/${hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline font-mono mt-2"
              >
                View transaction
              </a>
            )}
            <Button variant="link" onClick={onClose} className="mt-4">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Liquidate Position</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Max repayable: {maxDebt} {debtSymbol} (50% close factor)
              </p>
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Repay Amount</label>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, debtDecimals) && Number(v) >= 0)) setAmount(v); }}
                  placeholder="0.00"
                  className="h-12 text-lg bg-transparent border-border font-mono"
                />
                {exceedsMax && (
                  <p className="text-xs text-destructive mt-1">Amount exceeds max liquidatable (50% close factor)</p>
                )}
                {insufficientBalance && !exceedsMax && (
                  <p className="text-xs text-destructive mt-1">Insufficient balance</p>
                )}
              </div>
              <TxButton
                onClick={handleLiquidate}
                isPending={isPending || approval.isPending}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!address || !amount || parsedAmount === 0n || exceedsMax || insufficientBalance}
              >
                {approval.needsApproval(parsedAmount) ? `Approve ${debtSymbol}` : "Execute Liquidation"}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
