"use client";

import { useState, useEffect } from "react";
import { parseUnits, formatUnits } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { POOL_ABI, ATOKEN_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { formatHealthFactor } from "@/lib/format";
import { getMarketByAsset } from "@/lib/constants";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface WithdrawModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function WithdrawModal({ asset, symbol, decimals, onClose }: WithdrawModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsedAmount = amount ? parseUnits(amount, decimals) : 0n;

  const market = getMarketByAsset(asset);
  const { healthFactor } = useHealthFactor();

  // Supplied balance (aToken balance)
  const suppliedBalance = useReadContract({
    address: market?.aToken,
    abi: ATOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!market },
  });
  const supplied = (suppliedBalance.data as bigint) ?? 0n;
  const suppliedFormatted = formatUnits(supplied, decimals);

  // Health factor helpers
  const isMaxHf = healthFactor === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const hfNum = healthFactor ? (isMaxHf ? Infinity : Number(healthFactor) / 1e18) : 0;

  useEffect(() => {
    if (error) {
      toast.error("Withdrawal failed", {
        description: parseErrorMessage(error),
      });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Withdrawal successful", {
        description: "Transaction confirmed",
        action: {
          label: "View on Explorer",
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank"),
        },
      });
    }
  }, [isSuccess, hash]);

  const handleWithdraw = () => {
    writeContract({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "withdraw",
      args: [asset, parsedAmount, address!],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Withdrawal Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">You withdrew {amount} {symbol}</p>
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
              <DialogTitle>Withdraw {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Supplied: <span className="font-mono">{Number(suppliedFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
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
                    onClick={() => setAmount(suppliedFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {parsedAmount > supplied && (
                  <p className="text-xs text-destructive mt-1">Amount exceeds supplied balance</p>
                )}
              </div>

              {/* Health Factor */}
              {healthFactor && (
                <div className="technical-border bg-background p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <span className="font-mono font-medium">{formatHealthFactor(healthFactor)}</span>
                  </div>
                  {!isMaxHf && hfNum < 1.5 && (
                    <p className="text-xs text-amber-500 font-medium">
                      Warning: Withdrawing may lower your health factor and increase liquidation risk.
                    </p>
                  )}
                  {!isMaxHf && hfNum >= 1.5 && (
                    <p className="text-xs text-muted-foreground">Withdrawing reduces your health factor</p>
                  )}
                </div>
              )}

              <TxButton
                onClick={handleWithdraw}
                isPending={isPending}
                isConfirming={isConfirming}
                disabled={!amount || parsedAmount === 0n || parsedAmount > supplied}
              >
                Withdraw {symbol}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
