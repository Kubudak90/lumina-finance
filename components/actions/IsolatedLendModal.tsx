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

interface IsolatedLendModalProps {
  pair: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  onClose: () => void;
}

export function IsolatedLendModal({ pair, asset, assetSymbol, assetDecimals, onClose }: IsolatedLendModalProps) {
  const [amount, setAmount] = useState("");
  const [pendingDepositAfterApproval, setPendingDepositAfterApproval] = useState(false);
  const pendingAmountRef = useRef<bigint>(0n);

  const { address } = useAccount();
  const approval = useTokenApproval(asset, pair, address);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;

  const balance = useReadContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const balanceRaw = (balance.data as bigint | undefined) ?? 0n;
  const balanceFormatted = formatUnits(balanceRaw, assetDecimals);

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Lend failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Asset deposited", {
        description: `Lent ${amount} ${assetSymbol}`,
        action: { label: "View", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash, amount, assetSymbol]);

  useEffect(() => {
    setPendingDepositAfterApproval(false);
  }, [amount]);

  // Auto-chain deposit after approval succeeds
  useEffect(() => {
    if (approval.isSuccess && pendingDepositAfterApproval) {
      setPendingDepositAfterApproval(false);
      if (!address) return;
      writeContract({
        address: pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "deposit",
        args: [pendingAmountRef.current, address],
      });
    }
  }, [approval.isSuccess, pendingDepositAfterApproval, pair, address, writeContract]);

  const handleLend = () => {
    if (!address) return;
    if (approval.needsApproval(parsed)) {
      pendingAmountRef.current = parsed;
      approval.approve(parsed);
      setPendingDepositAfterApproval(true);
      return;
    }
    writeContract({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "deposit",
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
              <DialogTitle className="text-xl">Lent {amount} {assetSymbol}</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">Your shares are minted in the pair</p>
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Lend {assetSymbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Deposit {assetSymbol} to earn yield from borrowers in this isolated pair.
                You receive ERC4626-style shares representing your share of the pool.
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{Number(balanceFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {assetSymbol}
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
                    onClick={() => setAmount(balanceFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {parsed > balanceRaw && (
                  <p className="text-xs text-destructive mt-1">Insufficient balance</p>
                )}
              </div>
              <TxButton
                onClick={handleLend}
                isPending={isPending || approval.isPending}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!address || !amount || parsed === 0n || parsed > balanceRaw}
              >
                {approval.needsApproval(parsed) ? `Approve ${assetSymbol}` : `Lend ${assetSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
