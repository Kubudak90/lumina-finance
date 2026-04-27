"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { LOOPING_ABI, ATOKEN_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { parseErrorMessage } from "@/lib/errorMessages";

interface Props {
  yieldAsset: `0x${string}`;
  yieldSymbol: string;
  yieldDecimals: number;
  yieldAToken: `0x${string}`;
  debtAsset: `0x${string}`;
  debtSymbol: string;
  debtDecimals: number;
  debtVariableToken: `0x${string}`;
  swapper: `0x${string}` | undefined;
  onClose: () => void;
}

const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * Closes a leveraged position via Looping.closePosition().
 *
 * Flow:
 *   1. Read user's current aToken (yield) and variableDebt (debt) balances
 *   2. User approves aToken to Looping (max) so the contract can pull collateral
 *   3. Call closePosition with withdrawAmount=MAX (full close), flashloanAmount
 *      sized to current debt — Looping flash-loans debt, repays user's debt,
 *      withdraws yield collateral, swaps it back, repays the flash loan, and
 *      refunds any leftover to the user.
 */
export function LeverageCloseModal({
  yieldAsset,
  yieldSymbol,
  yieldDecimals,
  yieldAToken,
  debtAsset,
  debtSymbol,
  debtDecimals,
  debtVariableToken,
  swapper,
  onClose,
}: Props) {
  const { address } = useAccount();
  const [pendingCloseAfterApproval, setPendingCloseAfterApproval] = useState(false);

  const aTokenApproval = useTokenApproval(yieldAToken, ADDRESSES.looping, address);

  // Read current balances
  const aTokenBalance = useReadContract({
    address: yieldAToken,
    abi: ATOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const debtBalance = useReadContract({
    address: debtVariableToken,
    abi: VARIABLE_DEBT_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const yieldRaw = (aTokenBalance.data as bigint | undefined) ?? 0n;
  const debtRaw = (debtBalance.data as bigint | undefined) ?? 0n;

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Close Position failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Position closed", {
        action: { label: "View", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash]);

  // Auto-chain close after approval
  useEffect(() => {
    if (aTokenApproval.isSuccess && pendingCloseAfterApproval) {
      setPendingCloseAfterApproval(false);
      executeClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aTokenApproval.isSuccess, pendingCloseAfterApproval]);

  const executeClose = () => {
    if (!address || !swapper) return;
    const path: `0x${string}`[] = [yieldAsset, debtAsset];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
    // flashloanAmount must cover the actual debt; use current debt + 0.1% buffer
    // for any interest accrued between read and execution.
    const flashloanAmount = (debtRaw * 1001n) / 1000n + 1n;

    writeContract({
      address: ADDRESSES.looping,
      abi: LOOPING_ABI,
      functionName: "closePosition",
      args: [
        ADDRESSES.pool,
        swapper,
        debtAsset,
        yieldAsset,
        flashloanAmount,
        0n,             // minAmountOut (testnet)
        path,
        MAX_UINT256,    // withdrawAmount = MAX → contract reads actual balances
        deadline,
      ],
    });
  };

  const needsApproval = aTokenApproval.needsApproval(yieldRaw);

  const handleClose = () => {
    if (!address || !swapper || debtRaw === 0n || yieldRaw === 0n) return;
    if (needsApproval) {
      aTokenApproval.approve(MAX_UINT256);
      setPendingCloseAfterApproval(true);
      return;
    }
    executeClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Position Closed</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">
              {yieldSymbol} collateral was withdrawn, debt repaid, and any leftover refunded
            </p>
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Close {yieldSymbol}/{debtSymbol} Position</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Flash-loans {debtSymbol} to repay debt, withdraws your {yieldSymbol} collateral,
                swaps it back to {debtSymbol} to repay the flash loan, and refunds any
                surplus to your wallet.
              </p>

              <div className="technical-border bg-background p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collateral ({yieldSymbol})</span>
                  <span className="font-mono">{Number(formatUnits(yieldRaw, yieldDecimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Debt ({debtSymbol})</span>
                  <span className="font-mono">{Number(formatUnits(debtRaw, debtDecimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })}</span>
                </div>
              </div>

              {!swapper && (
                <p className="text-xs text-amber-400 font-mono">No DEX adapter whitelisted — close will revert</p>
              )}

              <TxButton
                onClick={handleClose}
                isPending={isPending || aTokenApproval.isPending}
                isConfirming={isConfirming || aTokenApproval.isConfirming}
                disabled={!address || debtRaw === 0n || yieldRaw === 0n || !swapper}
              >
                {needsApproval ? `Approve a${yieldSymbol}` : "Close Position"}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
