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

interface Props {
  pair: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  borrowedAmount: bigint;     // user's current debt in asset units
  borrowedShares: bigint;     // user's current debt in shares
  onClose: () => void;
}

/**
 * Borrower-side repayment — calls LightlendPair.repayAsset(shares, borrower)
 * after approving the asset to the pair. Repaying by amount is implemented by
 * calling toBorrowShares(amount) for each input.
 */
export function IsolatedRepayModal({
  pair,
  asset,
  assetSymbol,
  assetDecimals,
  borrowedAmount,
  borrowedShares,
  onClose,
}: Props) {
  const [amount, setAmount] = useState("");
  const [pendingRepayAfterApproval, setPendingRepayAfterApproval] = useState(false);
  const pendingSharesRef = useRef<bigint>(0n);

  const { address } = useAccount();
  const approval = useTokenApproval(asset, pair, address);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const maxFmt = formatUnits(borrowedAmount, assetDecimals);
  const overMax = parsed > borrowedAmount;

  // Convert input amount → shares using on-chain conversion
  const sharesPreview = useReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowShares",
    args: [parsed, false, true],
    query: { enabled: parsed > 0n && parsed <= borrowedAmount },
  });
  const computedShares = (sharesPreview.data as bigint | undefined) ?? 0n;

  // Wallet balance gate
  const walletBalance = useReadContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const walletRaw = (walletBalance.data as bigint | undefined) ?? 0n;
  const insufficientWallet = parsed > walletRaw;

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Repay failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Debt repaid", {
        description: `Repaid ~${amount} ${assetSymbol}`,
        action: { label: "View", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash, amount, assetSymbol]);

  useEffect(() => {
    setPendingRepayAfterApproval(false);
  }, [amount]);

  // Auto-chain repay after approval
  useEffect(() => {
    if (approval.isSuccess && pendingRepayAfterApproval && pendingSharesRef.current > 0n) {
      setPendingRepayAfterApproval(false);
      if (!address) return;
      writeContract({
        address: pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "repayAsset",
        args: [pendingSharesRef.current, address],
      });
    }
  }, [approval.isSuccess, pendingRepayAfterApproval, pair, address, writeContract]);

  const handleRepay = () => {
    if (!address) return;
    // For full repay, use exact borrowedShares (avoids dust from rounding)
    const sharesToRepay = parsed >= borrowedAmount ? borrowedShares : computedShares;
    if (sharesToRepay === 0n) return;

    if (approval.needsApproval(parsed)) {
      pendingSharesRef.current = sharesToRepay;
      approval.approve(parsed);
      setPendingRepayAfterApproval(true);
      return;
    }
    writeContract({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "repayAsset",
      args: [sharesToRepay, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Repaid {amount} {assetSymbol}</DialogTitle>
            </DialogHeader>
            <Button variant="link" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Repay {assetSymbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pay back {assetSymbol} to settle your debt in this isolated pair.
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Debt: <span className="font-mono">{Number(maxFmt).toLocaleString("en-US", { maximumFractionDigits: 6 })}</span> {assetSymbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, assetDecimals) && Number(v) >= 0)) setAmount(v); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setAmount(maxFmt)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {insufficientWallet && (
                  <p className="text-xs text-destructive mt-1">Insufficient {assetSymbol} balance</p>
                )}
                {overMax && (
                  <p className="text-xs text-amber-400 mt-1">Capped at debt amount</p>
                )}
              </div>
              <TxButton
                onClick={handleRepay}
                isPending={isPending || approval.isPending}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!address || parsed === 0n || insufficientWallet}
              >
                {approval.needsApproval(parsed) ? `Approve ${assetSymbol}` : `Repay ${assetSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
