"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isValidDecimalInput, safeParseUnits } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";

interface Props {
  pair: `0x${string}`;
  collateralSymbol: string;
  collateralDecimals: number;
  collateralAmount: bigint; // user's current collateral
  onClose: () => void;
}

/**
 * Borrower-side collateral release — calls LightlendPair.removeCollateral(amount, receiver).
 * Reverts if the resulting position becomes insolvent.
 */
export function IsolatedRemoveCollateralModal({
  pair,
  collateralSymbol,
  collateralDecimals,
  collateralAmount,
  onClose,
}: Props) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsed = amount ? (safeParseUnits(amount, collateralDecimals) ?? 0n) : 0n;
  const maxFmt = formatUnits(collateralAmount, collateralDecimals);
  const overMax = parsed > collateralAmount;

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Remove collateral failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Collateral removed", {
        description: `Removed ${amount} ${collateralSymbol}`,
        action: { label: "View", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash, amount, collateralSymbol]);

  const handleRemove = () => {
    if (!address) return;
    writeContract({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "removeCollateral",
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
              <DialogTitle className="text-xl">Removed {amount} {collateralSymbol}</DialogTitle>
            </DialogHeader>
            <Button variant="link" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Remove {collateralSymbol} Collateral</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Withdraw {collateralSymbol} currently securing your debt.
                The pair will revert if the position becomes insolvent.
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Posted: <span className="font-mono">{Number(maxFmt).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {collateralSymbol}
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
                    onClick={() => setAmount(maxFmt)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {overMax && <p className="text-xs text-destructive mt-1">Exceeds posted collateral</p>}
              </div>
              <TxButton
                onClick={handleRemove}
                isPending={isPending}
                isConfirming={isConfirming}
                disabled={!address || parsed === 0n || overMax}
              >
                Remove {collateralSymbol}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
