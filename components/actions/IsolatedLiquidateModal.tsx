"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useSimulatedWrite } from "@/hooks/useSimulatedWrite";
import { txExplorerUrl } from "@/lib/explorer";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { ERC20_ABI, ISOLATED_PAIR_ABI } from "@/lib/abis";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isValidDecimalInput, safeParseUnits, truncateAddress } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";

interface Props {
  pair: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  collateralSymbol: string;
  collateralDecimals: number;
  borrower: `0x${string}`;
  borrowerDebtAsset: bigint;     // amount of asset debt the borrower owes (display)
  borrowerDebtShares: bigint;    // share count of borrower's debt
  borrowerCollateral: bigint;
  onClose: () => void;
}

const MAX_UINT128 = 2n ** 128n - 1n;

/**
 * LightlendPair.liquidate(_sharesToLiquidate, _deadline, _borrower).
 * Liquidator pays in the asset (asset.transferFrom on liquidator) and receives
 * collateral. Reverts if borrower is solvent. Approval needed: asset → pair
 * for the asset amount equivalent to the shares being liquidated.
 */
export function IsolatedLiquidateModal({
  pair,
  asset,
  assetSymbol,
  assetDecimals,
  collateralSymbol,
  collateralDecimals,
  borrower,
  borrowerDebtAsset,
  borrowerDebtShares,
  borrowerCollateral,
  onClose,
}: Props) {
  const [amount, setAmount] = useState("");
  const [pendingLiqAfterApproval, setPendingLiqAfterApproval] = useState(false);
  const pendingSharesRef = useRef<bigint>(0n);

  const { address } = useAccount();
  const approval = useTokenApproval(asset, pair, address);

  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useSimulatedWrite();

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const maxFmt = formatUnits(borrowerDebtAsset, assetDecimals);

  // Convert input asset amount → shares using on-chain conversion
  const sharesPreview = useReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowShares",
    args: [parsed, false, true],
    query: { enabled: parsed > 0n && parsed <= borrowerDebtAsset },
  });
  const computedShares = (sharesPreview.data as bigint | undefined) ?? 0n;

  // Wallet balance
  const walletBalance = useReadContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const walletRaw = (walletBalance.data as bigint | undefined) ?? 0n;
  const insufficientWallet = parsed > walletRaw;

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Liquidate failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Liquidation successful", {
        description: `Received ${collateralSymbol} collateral`,
        action: { label: "View", onClick: () => window.open(txExplorerUrl(hash), "_blank") },
      });
    }
  }, [isSuccess, hash, collateralSymbol]);

  useEffect(() => {
    setPendingLiqAfterApproval(false);
  }, [amount]);

  // Auto-chain after approval
  useEffect(() => {
    if (approval.isSuccess && pendingLiqAfterApproval && pendingSharesRef.current > 0n) {
      setPendingLiqAfterApproval(false);
      doLiquidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approval.isSuccess, pendingLiqAfterApproval]);

  const doLiquidate = () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
    let shares = parsed >= borrowerDebtAsset ? borrowerDebtShares : pendingSharesRef.current || computedShares;
    if (shares > MAX_UINT128) shares = MAX_UINT128;
    void send({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "liquidate",
      args: [shares, deadline, borrower],
    });
  };

  const handleLiquidate = () => {
    if (!address) return;
    const sharesToLiquidate = parsed >= borrowerDebtAsset ? borrowerDebtShares : computedShares;
    if (sharesToLiquidate === 0n) return;

    if (approval.needsApproval(parsed)) {
      pendingSharesRef.current = sharesToLiquidate;
      approval.approve(parsed);
      setPendingLiqAfterApproval(true);
      return;
    }
    pendingSharesRef.current = sharesToLiquidate;
    doLiquidate();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Liquidation Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">
              Repaid {amount} {assetSymbol} of {truncateAddress(borrower)}&apos;s debt; received {collateralSymbol} as reward
            </p>
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Liquidate Position</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="technical-border bg-background p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Borrower</span>
                  <span className="font-mono">{truncateAddress(borrower)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Debt</span>
                  <span className="font-mono">{Number(maxFmt).toLocaleString("en-US", { maximumFractionDigits: 6 })} {assetSymbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collateral</span>
                  <span className="font-mono">{Number(formatUnits(borrowerCollateral, collateralDecimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })} {collateralSymbol}</span>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Pay {assetSymbol} to settle part or all of the borrower&apos;s debt and receive
                {" "}{collateralSymbol} (with discount). The pair reverts if the borrower
                is solvent at execution time.
              </p>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount to Repay ({assetSymbol})</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{Number(formatUnits(walletRaw, assetDecimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
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
                {insufficientWallet && (
                  <p className="text-xs text-destructive mt-1">Insufficient {assetSymbol} balance</p>
                )}
              </div>

              <TxButton
                onClick={handleLiquidate}
                isPending={isPending || approval.isPending}
                isSimulating={isSimulating || approval.isSimulating}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!address || parsed === 0n || insufficientWallet || borrowerDebtShares === 0n}
              >
                {approval.needsApproval(parsed) ? `Approve ${assetSymbol}` : "Liquidate"}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
