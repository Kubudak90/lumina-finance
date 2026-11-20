"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useLuminaWrite } from "@/hooks/chain";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { useIsolatedPosition } from "@/hooks/useUserIsolatedPositions";
import { explorerToastAction } from "@/lib/explorer";
import { GUARD_BLOCKED_NOTE } from "@/lib/guard";
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
  onClose: () => void;
}

/**
 * Borrower-side collateral release — calls LightlendPair.removeCollateral(amount, receiver).
 * Reverts if the resulting position becomes insolvent.
 */
export function IsolatedRemoveCollateralModal({ pair, onClose }: Props) {
  // Live pair and position data on every render (Codex #8).
  const info = useIsolatedPair(pair);
  const position = useIsolatedPosition(pair);
  const collateralSymbol = info?.collateralSymbol ?? "";
  const collateralDecimals = info?.collateralDecimals ?? 18;
  const collateralAmount = position?.collateralAmount ?? 0n;
  const hasDebt = (position?.borrowedShares ?? 0n) > 0n;
  // Pair oracle bad data (price guard tripped): removal while in debt reverts.
  const oracleBadData = info?.oracleBadData;
  const [amount, setAmount] = useState("");
  const { address } = useAccount();

  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();
  const blocked = hasDebt && oracleBadData !== false;

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
        action: explorerToastAction(hash, "View"),
      });
    }
  }, [isSuccess, hash, amount, collateralSymbol]);

  const handleRemove = () => {
    if (!address) return;
    void send({
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
              {blocked && (
                <p className="text-xs text-amber-400">
                  {oracleBadData === undefined
                    ? "Pair oracle status unknown; removing collateral while in debt is disabled."
                    : `The price guard blocks borrows on this pair. ${GUARD_BLOCKED_NOTE.isolated}`}
                </p>
              )}
              <TxButton
                onClick={handleRemove}
                isPending={isPending}
                isSimulating={isSimulating}
                isConfirming={isConfirming}
                disabled={!address || parsed === 0n || overMax || blocked}
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
