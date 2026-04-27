"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { ERC20_ABI, ISOLATED_PAIR_ABI } from "@/lib/abis";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isValidDecimalInput, safeParseUnits } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";

interface IsolatedBorrowModalProps {
  pair: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  collateral: `0x${string}`;
  collateralSymbol: string;
  collateralDecimals: number;
  maxLTV: bigint; // 1e5-based (75_000 = 75%)
  onClose: () => void;
}

const LTV_PRECISION = 100_000n;

export function IsolatedBorrowModal({
  pair,
  assetSymbol,
  assetDecimals,
  collateral,
  collateralSymbol,
  collateralDecimals,
  maxLTV,
  onClose,
}: IsolatedBorrowModalProps) {
  const [collateralInput, setCollateralInput] = useState("");
  const [borrowInput, setBorrowInput] = useState("");
  const [pendingBorrowAfterApproval, setPendingBorrowAfterApproval] = useState(false);
  const pendingArgsRef = useRef<{ borrow: bigint; collateral: bigint } | null>(null);

  const { address } = useAccount();
  const collateralApproval = useTokenApproval(collateral, pair, address);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsedCollateral = collateralInput ? (safeParseUnits(collateralInput, collateralDecimals) ?? 0n) : 0n;
  const parsedBorrow = borrowInput ? (safeParseUnits(borrowInput, assetDecimals) ?? 0n) : 0n;

  const collateralBalance = useReadContract({
    address: collateral,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const collateralBalanceRaw = (collateralBalance.data as bigint | undefined) ?? 0n;
  const collateralBalanceFmt = formatUnits(collateralBalanceRaw, collateralDecimals);

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Borrow failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Borrow successful", {
        description: `Borrowed ${borrowInput} ${assetSymbol} against ${collateralInput} ${collateralSymbol}`,
        action: { label: "View", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash, borrowInput, collateralInput, assetSymbol, collateralSymbol]);

  useEffect(() => {
    setPendingBorrowAfterApproval(false);
  }, [collateralInput, borrowInput]);

  useEffect(() => {
    if (collateralApproval.isSuccess && pendingBorrowAfterApproval && pendingArgsRef.current) {
      setPendingBorrowAfterApproval(false);
      if (!address) return;
      writeContract({
        address: pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "borrowAsset",
        args: [pendingArgsRef.current.borrow, pendingArgsRef.current.collateral, address],
      });
    }
  }, [collateralApproval.isSuccess, pendingBorrowAfterApproval, pair, address, writeContract]);

  const handleBorrow = () => {
    if (!address) return;
    if (collateralApproval.needsApproval(parsedCollateral)) {
      pendingArgsRef.current = { borrow: parsedBorrow, collateral: parsedCollateral };
      collateralApproval.approve(parsedCollateral);
      setPendingBorrowAfterApproval(true);
      return;
    }
    writeContract({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "borrowAsset",
      args: [parsedBorrow, parsedCollateral, address],
    });
  };

  // Naive LTV display: borrowed / collateral (assumes 1:1 pricing, oracle calc would be exact)
  const ltvBps = parsedCollateral > 0n
    ? Number((parsedBorrow * LTV_PRECISION) / parsedCollateral)
    : 0;
  const ltvPercent = (ltvBps / 1000).toFixed(2);
  const maxLtvPercent = (Number(maxLTV) / 1000).toFixed(2);
  const overLtv = parsedCollateral > 0n && BigInt(ltvBps) > maxLTV;
  const insufficientCollateral = parsedCollateral > collateralBalanceRaw;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Borrow Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">
              Borrowed {borrowInput} {assetSymbol} against {collateralInput} {collateralSymbol}
            </p>
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Borrow {assetSymbol} (collateral: {collateralSymbol})</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Post {collateralSymbol} as collateral and borrow {assetSymbol} in a single transaction.
                Max LTV in this pair is {maxLtvPercent}%.
              </p>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Collateral ({collateralSymbol})</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{Number(collateralBalanceFmt).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {collateralSymbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    value={collateralInput}
                    onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, collateralDecimals) && Number(v) >= 0)) setCollateralInput(v); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setCollateralInput(collateralBalanceFmt)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {insufficientCollateral && (
                  <p className="text-xs text-destructive mt-1">Insufficient {collateralSymbol} balance</p>
                )}
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Borrow ({assetSymbol})</label>
                <Input
                  type="number"
                  value={borrowInput}
                  onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, assetDecimals) && Number(v) >= 0)) setBorrowInput(v); }}
                  placeholder="0.00"
                  min="0"
                  step="any"
                  className="h-12 text-lg bg-transparent border-border font-mono"
                />
              </div>

              {parsedCollateral > 0n && parsedBorrow > 0n && (
                <div className="technical-border bg-background p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Position LTV (1:1 estimate)</span>
                    <span className={`font-mono ${overLtv ? "text-rose-400" : "text-emerald-400"}`}>{ltvPercent}%</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Max LTV in pair</span>
                    <span className="font-mono">{maxLtvPercent}%</span>
                  </div>
                  {overLtv && (
                    <p className="text-xs text-amber-400">Estimate exceeds pair LTV — oracle prices may differ</p>
                  )}
                </div>
              )}

              <TxButton
                onClick={handleBorrow}
                isPending={isPending || collateralApproval.isPending}
                isConfirming={isConfirming || collateralApproval.isConfirming}
                disabled={!address || parsedCollateral === 0n || parsedBorrow === 0n || insufficientCollateral}
              >
                {collateralApproval.needsApproval(parsedCollateral) ? `Approve ${collateralSymbol}` : `Borrow ${assetSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
