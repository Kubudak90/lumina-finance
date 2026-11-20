"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { explorerToastAction } from "@/lib/explorer";
import { exactApproval } from "@/lib/approvals";
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
  collateral: `0x${string}`;
  collateralSymbol: string;
  collateralDecimals: number;
  onClose: () => void;
}

/**
 * LightlendPair.addCollateral(amount, borrower) with an exact approval. Works while the price
 * guard blocks borrows (spec §5.4), so a borrower can always top up instead of being liquidated.
 */
export function IsolatedAddCollateralModal({ pair, collateral, collateralSymbol, collateralDecimals, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [pendingAfterApproval, setPendingAfterApproval] = useState(false);
  const pendingAmountRef = useRef<bigint>(0n);
  const { address } = useAccount();
  const approval = useTokenApproval(collateral, pair, address);
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsed = amount ? (safeParseUnits(amount, collateralDecimals) ?? 0n) : 0n;

  const balance = useLuminaReadContract({
    address: collateral,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, ...QUERY.user },
  });
  const balanceRaw = (balance.data as bigint | undefined) ?? 0n;
  const balanceFormatted = formatUnits(balanceRaw, collateralDecimals);

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Add collateral failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Collateral added", {
        description: `Added ${amount} ${collateralSymbol}`,
        action: explorerToastAction(hash, "View"),
      });
    }
  }, [isSuccess, hash, amount, collateralSymbol]);

  useEffect(() => {
    setPendingAfterApproval(false);
  }, [amount]);

  useEffect(() => {
    if (approval.isSuccess && pendingAfterApproval) {
      setPendingAfterApproval(false);
      if (!address) return;
      void send({
        address: pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "addCollateral",
        args: [pendingAmountRef.current, address],
      });
    }
  }, [approval.isSuccess, pendingAfterApproval, pair, address, send]);

  const handleAdd = () => {
    if (!address || parsed === 0n) return;
    if (approval.needsApproval(parsed)) {
      pendingAmountRef.current = parsed;
      approval.approve(exactApproval(parsed));
      setPendingAfterApproval(true);
      return;
    }
    void send({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "addCollateral",
      args: [parsed, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Added {amount} {collateralSymbol}</DialogTitle>
            </DialogHeader>
            <Button variant="link" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add {collateralSymbol} Collateral</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Post more {collateralSymbol} to lower your LTV in this pair. Allowed even while borrowing is blocked.
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{Number(balanceFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {collateralSymbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, collateralDecimals) && Number(v) >= 0)) setAmount(v); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setAmount(balanceFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {parsed > balanceRaw && <p className="text-xs text-destructive mt-1">Insufficient balance</p>}
              </div>
              <AllowanceNote
                symbol={collateralSymbol}
                decimals={collateralDecimals}
                spenderLabel="pair"
                allowance={approval.allowance}
                approveAmount={parsed > 0n && approval.needsApproval(parsed) ? parsed : undefined}
              />
              <TxButton
                onClick={handleAdd}
                isPending={isPending || approval.isPending}
                isSimulating={isSimulating || approval.isSimulating}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!address || parsed === 0n || parsed > balanceRaw}
              >
                {approval.needsApproval(parsed) ? `Approve ${collateralSymbol}` : `Add ${collateralSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
