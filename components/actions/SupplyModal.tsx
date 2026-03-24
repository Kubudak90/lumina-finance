"use client";

import { useState, useEffect } from "react";
import { parseUnits, formatUnits } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { POOL_ABI, ERC20_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { formatHealthFactor } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SupplyModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function SupplyModal({ asset, symbol, decimals, onClose }: SupplyModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const approval = useTokenApproval(asset, ADDRESSES.pool, address);

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsedAmount = amount ? parseUnits(amount, decimals) : 0n;

  // Wallet balance
  const walletBalance = useReadContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const balance = (walletBalance.data as bigint) ?? 0n;
  const balanceFormatted = formatUnits(balance, decimals);

  // Health factor
  const { healthFactor } = useHealthFactor();

  useEffect(() => {
    if (error) {
      toast.error("Supply failed", {
        description: parseErrorMessage(error),
      });
    }
  }, [error]);

  useEffect(() => {
    if (approval.error) {
      toast.error("Approval failed", {
        description: parseErrorMessage(approval.error),
      });
    }
  }, [approval.error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Supply successful", {
        description: "Transaction confirmed",
        action: {
          label: "View on Explorer",
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank"),
        },
      });
    }
  }, [isSuccess, hash]);

  const handleSupply = () => {
    if (approval.needsApproval(parsedAmount)) {
      approval.approve();
      return;
    }
    writeContract({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "supply",
      args: [asset, parsedAmount, address!, 0],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Supply Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">You supplied {amount} {symbol}</p>
            {hash && (
              <a
                href={`https://sepolia.basescan.org/tx/${hash}`}
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
              <DialogTitle>Supply {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{Number(balanceFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => { const v = e.target.value; if (v === "" || Number(v) >= 0) setAmount(v); }}
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
                {parsedAmount > balance && (
                  <p className="text-xs text-destructive mt-1">Insufficient balance</p>
                )}
              </div>
              <TxButton
                onClick={handleSupply}
                isPending={isPending || approval.isPending}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!amount || parsedAmount === 0n || parsedAmount > balance}
              >
                {approval.needsApproval(parsedAmount) ? `Approve ${symbol}` : `Supply ${symbol}`}
              </TxButton>

              {/* Health Factor */}
              {healthFactor && (
                <div className="technical-border bg-background p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <span className="font-mono font-medium">{formatHealthFactor(healthFactor)}</span>
                  </div>
                  <p className="text-xs text-emerald-400">Supply increases your health factor</p>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
