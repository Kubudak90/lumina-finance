"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useLuminaWrite } from "@/hooks/chain";
import { explorerToastAction } from "@/lib/explorer";
import { TxButton } from "@/components/common/TxButton";
import { ExplorerLink } from "@/components/common/ExplorerLink";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { useUserPosition } from "@/hooks/useUserPosition";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { parseErrorMessage } from "@/lib/errorMessages";
import { formatHealthFactor } from "@/lib/format";

interface EnableCollateralModalProps {
  asset: `0x${string}`;
  symbol: string;
  currentlyEnabled: boolean;
  onClose: () => void;
}

export function EnableCollateralModal({ asset, symbol, currentlyEnabled, onClose }: EnableCollateralModalProps) {
  const { address } = useAccount();
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();
  const { positions, accountData } = useUserPosition();
  const healthFactor = accountData?.healthFactor;
  const pool = LUMINA.contracts.pool;

  // aToken balance — Aave V3 reverts (error 43) on enable with zero balance.
  const balance = positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase())?.supplied ?? 0n;
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
      toast.success(`Collateral ${newValue ? "enabled" : "disabled"}`, { action: explorerToastAction(hash) });
    }
  }, [isSuccess, hash, newValue]);

  const handleToggle = () => {
    if (!address || !pool || blockedNoSupply) return;
    void send({
      address: pool,
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
            {hash && <ExplorerLink hash={hash} />}
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

              {healthFactor !== undefined && !blockedNoSupply && (
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
                isSimulating={isSimulating}
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
