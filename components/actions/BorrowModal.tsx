"use client";

import { useState, useEffect } from "react";
import { parseUnits, formatUnits } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { POOL_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { formatHealthFactor } from "@/lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface BorrowModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function BorrowModal({ asset, symbol, decimals, onClose }: BorrowModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { healthFactor } = useHealthFactor();

  const parsedAmount = amount ? parseUnits(amount, decimals) : 0n;

  // Available liquidity in pool (ERC20 balance of underlying held by Pool)
  const poolBalance = useReadContract({
    address: asset,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
    functionName: "balanceOf",
    args: [ADDRESSES.pool],
  });
  const availableLiquidity = (poolBalance.data as bigint) ?? 0n;
  const availableFormatted = formatUnits(availableLiquidity > 0n ? availableLiquidity : 0n, decimals);

  // User's borrowing power from getUserAccountData
  const accountDataResult = useReadContract({
    address: ADDRESSES.pool,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  let availableBorrowsBase = 0n;
  try {
    const d = accountDataResult.data as Record<string, bigint> | readonly bigint[] | undefined;
    if (d) {
      if (Array.isArray(d)) {
        availableBorrowsBase = d[2] ?? 0n;
      } else {
        availableBorrowsBase = (d as Record<string, bigint>).availableBorrowsBase ?? 0n;
      }
    }
  } catch { /* ignore */ }

  // Convert availableBorrowsBase (8 decimals USD) to token amount using oracle price
  const { data: oraclePrice } = useReadContract({
    address: ADDRESSES.oracle,
    abi: [{ name: "getAssetPrice", type: "function", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
    functionName: "getAssetPrice",
    args: [asset],
  });
  const priceRaw = (oraclePrice as bigint) ?? 1n;
  const borrowCapTokens = priceRaw > 0n
    ? Number(availableBorrowsBase) / Number(priceRaw) // both in 8 decimals, result is token amount
    : 0;
  const maxBorrowTokens = Math.min(borrowCapTokens, Number(availableFormatted));
  // Truncate to token's decimal precision to avoid parseUnits failure (e.g. USDC has 6 decimals)
  const maxDigits = decimals > 6 ? 6 : decimals;
  const maxBorrowFormatted = maxBorrowTokens > 0 ? maxBorrowTokens.toFixed(maxDigits) : "0";

  // Health factor helpers
  const isMaxHf = healthFactor === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const hfNum = healthFactor ? (isMaxHf ? Infinity : Number(healthFactor) / 1e18) : 0;

  useEffect(() => {
    if (error) {
      toast.error("Borrow failed", {
        description: parseErrorMessage(error),
      });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Borrow successful", {
        description: "Transaction confirmed",
        action: {
          label: "View on Explorer",
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank"),
        },
      });
    }
  }, [isSuccess, hash]);

  const handleBorrow = () => {
    writeContract({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "borrow",
      args: [asset, parsedAmount, 2n, 0, address!],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Borrow Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">You borrowed {amount} {symbol}</p>
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
              <DialogTitle>Borrow {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Borrow capacity info */}
              <div className="technical-border bg-background p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Borrow Capacity</span>
                  <span className="font-mono">{borrowCapTokens.toLocaleString("en-US", { maximumFractionDigits: 4 })} {symbol}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pool Liquidity</span>
                  <span className="font-mono">{Number(availableFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })} {symbol}</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Max: <span className="font-mono">{Math.min(borrowCapTokens, Number(availableFormatted)).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
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
                    onClick={() => setAmount(maxBorrowFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {parsedAmount > availableLiquidity && availableLiquidity > 0n && (
                  <p className="text-xs text-destructive mt-1">Amount exceeds available liquidity</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Ensure you have sufficient collateral. Health factor must remain above 1.05.</p>

              {/* Health Factor */}
              {healthFactor && (
                <div className="technical-border bg-background p-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <span className="font-mono font-medium">{formatHealthFactor(healthFactor)}</span>
                  </div>
                  <HealthFactorBar healthFactor={healthFactor} />
                  {isMaxHf && (
                    <p className="text-xs text-muted-foreground">New borrower -- ensure you have collateral enabled</p>
                  )}
                  {!isMaxHf && hfNum < 1.2 && (
                    <p className="text-xs text-red-500 font-medium">
                      Warning: Your health factor is critically low. Borrowing more may result in immediate liquidation.
                    </p>
                  )}
                  {!isMaxHf && hfNum >= 1.2 && hfNum < 1.5 && (
                    <p className="text-xs text-amber-500 font-medium">
                      Warning: Your health factor is low. Borrowing more may put you at liquidation risk.
                    </p>
                  )}
                  {!isMaxHf && hfNum >= 1.5 && (
                    <p className="text-xs text-muted-foreground">Borrowing will reduce your health factor</p>
                  )}
                </div>
              )}

              <TxButton
                onClick={handleBorrow}
                isPending={isPending}
                isConfirming={isConfirming}
                disabled={!amount || parsedAmount === 0n || (availableLiquidity > 0n && parsedAmount > availableLiquidity)}
              >
                Borrow {symbol}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
