"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
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
  assetSymbol: string;
  assetDecimals: number;
  onClose: () => void;
}

/**
 * Lender-side withdraw — calls LightlendPair.withdraw(amount, receiver, owner).
 * No token approval needed (the pair burns the lender's shares directly).
 */
export function IsolatedWithdrawModal({ pair, assetSymbol, assetDecimals, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const max = useReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "maxWithdraw",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });
  const maxRaw = (max.data as bigint | undefined) ?? 0n;
  const maxFmt = formatUnits(maxRaw, assetDecimals);
  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const overMax = parsed > maxRaw;

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Withdraw failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Withdraw successful", {
        description: `Withdrew ${amount} ${assetSymbol}`,
        action: { label: "View", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash, amount, assetSymbol]);

  const handleWithdraw = () => {
    if (!address) return;
    writeContract({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "withdraw",
      args: [parsed, address, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Withdrew {amount} {assetSymbol}</DialogTitle>
            </DialogHeader>
            <Button variant="link" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Withdraw {assetSymbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Burn lender shares and receive {assetSymbol} back from the isolated pair.
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Available: <span className="font-mono">{Number(maxFmt).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {assetSymbol}
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
                {overMax && <p className="text-xs text-destructive mt-1">Exceeds available balance</p>}
              </div>
              <TxButton
                onClick={handleWithdraw}
                isPending={isPending}
                isConfirming={isConfirming}
                disabled={!address || parsed === 0n || overMax}
              >
                Withdraw {assetSymbol}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
