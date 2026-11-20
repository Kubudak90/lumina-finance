"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { explorerToastAction } from "@/lib/explorer";
import { planIsolatedRepay, type IsolatedRepayPlan } from "@/lib/approvals";
import { QUERY } from "@/lib/queryPolicy";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
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
  borrowedAmount: bigint; // user's current debt in asset units (display)
  borrowedShares: bigint; // user's current debt in shares
  onClose: () => void;
}

/**
 * Borrower-side repayment: LightlendPair.repayAsset(shares, borrower). Repays are share-based, so
 * the pair pulls the shares' value as of the repay block. Every repay, partial or full, approves
 * ceil(currentShareValue × 1.001) + 1 (spec §3.3, R1-5, R2-1).
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
  const planRef = useRef<IsolatedRepayPlan | null>(null);
  const [submittedFull, setSubmittedFull] = useState(false);

  const { address } = useAccount();
  const approval = useTokenApproval(asset, pair, address);

  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const maxFmt = formatUnits(borrowedAmount, assetDecimals);
  const full = parsed > 0n && parsed >= borrowedAmount;

  // Partial: shares for the input amount (rounded down, previewing interest).
  const sharesPreview = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowShares",
    args: [parsed, false, true],
    query: { enabled: parsed > 0n && !full, ...QUERY.user },
  });
  const sharesForInput = (sharesPreview.data as bigint | undefined) ?? 0n;
  const shares = full ? borrowedShares : sharesForInput;

  // Current value of exactly those shares (rounded up, previewing interest): the R2-1 assetValue.
  const shareValueRead = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowAmount",
    args: [shares, true, true],
    query: { enabled: shares > 0n, ...QUERY.user },
  });
  const shareValue = shareValueRead.data as bigint | undefined;

  const plan =
    shares > 0n && shareValue !== undefined && shareValue > 0n
      ? planIsolatedRepay({ full, borrowedShares, sharesForInput, shareValue })
      : null;
  // Share value grows every block, so the buffered amount is what must be approved.
  const approvalNeeded = plan !== null && approval.needsApproval(plan.approve);

  const walletBalance = useLuminaReadContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, ...QUERY.user },
  });
  const walletRaw = (walletBalance.data as bigint | undefined) ?? 0n;
  const insufficientWallet = (plan?.assetValue ?? parsed) > walletRaw;

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
        action: explorerToastAction(hash, "View"),
      });
    }
  }, [isSuccess, hash, amount, assetSymbol]);

  useEffect(() => {
    setPendingRepayAfterApproval(false);
  }, [amount]);

  // Auto-chain repay after approval.
  useEffect(() => {
    if (approval.isSuccess && pendingRepayAfterApproval && planRef.current) {
      setPendingRepayAfterApproval(false);
      if (!address) return;
      void send({
        address: pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "repayAsset",
        args: [planRef.current.shares, address],
      });
    }
  }, [approval.isSuccess, pendingRepayAfterApproval, pair, address, send]);

  const handleRepay = () => {
    if (!address || !plan) return;
    planRef.current = plan;
    setSubmittedFull(plan.full);
    if (approvalNeeded) {
      approval.approve(plan.approve);
      setPendingRepayAfterApproval(true);
      return;
    }
    void send({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "repayAsset",
      args: [plan.shares, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Repaid {submittedFull ? "all" : amount} {assetSymbol}</DialogTitle>
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
                {insufficientWallet && parsed > 0n && (
                  <p className="text-xs text-destructive mt-1">Insufficient {assetSymbol} balance</p>
                )}
                {full && (
                  <p className="text-xs text-muted-foreground mt-1">Full repay: all your borrow shares are repaid (no dust).</p>
                )}
              </div>

              <AllowanceNote
                symbol={assetSymbol}
                decimals={assetDecimals}
                spenderLabel="pair"
                allowance={approval.allowance}
                approveAmount={plan && approvalNeeded ? plan.approve : undefined}
                expectedPull={plan?.assetValue}
                buffered
              />

              <TxButton
                onClick={handleRepay}
                isPending={isPending || approval.isPending}
                isSimulating={isSimulating || approval.isSimulating}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!address || !plan || insufficientWallet}
              >
                {approvalNeeded ? `Approve ${assetSymbol}` : `Repay ${assetSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
