"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { TxButton } from "@/components/common/TxButton";
import { POOL_ABI, ERC20_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { formatHealthFactor } from "@/lib/format";
import { getMarketByAsset } from "@/lib/constants";

interface EnableCollateralModalProps {
  asset: `0x${string}`;
  symbol: string;
  currentlyEnabled: boolean;
  onClose: () => void;
}

export function EnableCollateralModal({ asset, symbol, currentlyEnabled, onClose }: EnableCollateralModalProps) {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { healthFactor } = useHealthFactor();

  const market = getMarketByAsset(asset);
  const aTokenAddress = market?.aToken;

  // Read user's aToken balance — Aave V3 reverts (error 43) on enable with zero balance.
  const aTokenBalance = useReadContract({
    address: aTokenAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!aTokenAddress, refetchInterval: 15_000 },
  });
  const balance = (aTokenBalance.data as bigint | undefined) ?? 0n;
  const hasSupply = balance > 0n;

  const newValue = !currentlyEnabled;
  const actionLabel = newValue ? "Enable" : "Disable";
  const blockedNoSupply = newValue && !hasSupply;
  const prevErrorRef = useRef<Error | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error(`${actionLabel} collateral failed`, { description: parseErrorMessage(error) });
    }
  }, [error, actionLabel]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success(`Collateral ${newValue ? "enabled" : "disabled"}`, {
        action: { label: "View on Explorer", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash, newValue]);

  const handleToggle = () => {
    if (!address || blockedNoSupply) return;
    writeContract({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "setUserUseReserveAsCollateral",
      args: [asset, newValue],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Collateral {newValue ? "Enabled" : "Disabled"}</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">
              You {newValue ? "enabled" : "disabled"} {symbol} as collateral
            </p>
            {hash && (
              <a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline font-mono">
                View transaction
              </a>
            )}
            <Button variant="link" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{actionLabel} {symbol} as Collateral</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {newValue
                  ? `Enabling as collateral allows you to borrow against your supplied ${symbol}.`
                  : `Disabling collateral means your ${symbol} will no longer back your borrows. This may lower your health factor.`}
              </p>

              {blockedNoSupply && (
                <div className="technical-border bg-amber-500/10 border-amber-500/30 p-3 space-y-2">
                  <p className="text-sm text-amber-400 font-medium">
                    You have no {symbol} supplied
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Aave V3 requires an aToken balance before an asset can be used as collateral.
                    Supply {symbol} first, after which it will be enabled as collateral automatically.
                  </p>
                  <Link
                    href={`/markets/${symbol.toLowerCase()}`}
                    onClick={onClose}
                    className="inline-block mt-1 text-xs text-accent hover:underline font-mono uppercase tracking-wider"
                  >
                    Go to {symbol} Market &rarr;
                  </Link>
                </div>
              )}

              {healthFactor && !blockedNoSupply && (
                <div className="technical-border bg-background p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <span className="font-mono font-medium">{formatHealthFactor(healthFactor)}</span>
                  </div>
                  <p className={`text-xs ${newValue ? "text-emerald-400" : "text-amber-500"}`}>
                    {newValue ? "Enabling collateral increases your borrowing power" : "Disabling may lower your health factor"}
                  </p>
                </div>
              )}

              <TxButton
                onClick={handleToggle}
                isPending={isPending}
                isConfirming={isConfirming}
                disabled={!address || blockedNoSupply}
              >
                {blockedNoSupply ? `Supply ${symbol} first` : `${actionLabel} Collateral`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
