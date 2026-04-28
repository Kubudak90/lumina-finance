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
const PERCENTAGES = [25, 50, 75, 100] as const;
type Percent = (typeof PERCENTAGES)[number];

/**
 * Closes a leveraged position via Looping.closePosition() — supports partial
 * close via 25/50/75/100% buttons. 100% uses withdrawAmount=MAX so the
 * contract reads live balances; other percentages compute proportional
 * withdrawAmount and flashloanAmount values.
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
  const [percent, setPercent] = useState<Percent>(100);
  const [pendingCloseAfterApproval, setPendingCloseAfterApproval] = useState(false);

  const aTokenApproval = useTokenApproval(yieldAToken, ADDRESSES.looping, address);

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
      toast.success(`Closed ${percent}% of position`, {
        action: { label: "View", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash, percent]);

  // Auto-chain close after approval
  useEffect(() => {
    if (aTokenApproval.isSuccess && pendingCloseAfterApproval) {
      setPendingCloseAfterApproval(false);
      executeClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aTokenApproval.isSuccess, pendingCloseAfterApproval]);

  // For partial close we need to approve enough aToken; for full close we use MAX
  const requiredAtokenApproval = percent === 100 ? yieldRaw : (yieldRaw * BigInt(percent)) / 100n;

  const executeClose = () => {
    if (!address || !swapper) return;
    const path: `0x${string}`[] = [yieldAsset, debtAsset];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);

    let withdrawAmount: bigint;
    let flashloanAmount: bigint;
    if (percent === 100) {
      // Contract reads live balances; pass MAX for withdrawAmount and live debt + 0.1% buffer for flashloan
      withdrawAmount = MAX_UINT256;
      flashloanAmount = (debtRaw * 1001n) / 1000n + 1n;
    } else {
      const fraction = BigInt(percent);
      withdrawAmount = (yieldRaw * fraction) / 100n;
      // For partial close, flashloanAmount becomes repaymentAmount.
      // Add 0.1% buffer for interest accrued between read and tx.
      flashloanAmount = ((debtRaw * fraction) / 100n) * 1001n / 1000n + 1n;
    }

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
        0n,
        path,
        withdrawAmount,
        deadline,
      ],
    });
  };

  const needsApproval = aTokenApproval.needsApproval(requiredAtokenApproval);

  const handleClose = () => {
    if (!address || !swapper || debtRaw === 0n || yieldRaw === 0n) return;
    if (needsApproval) {
      aTokenApproval.approve(MAX_UINT256);
      setPendingCloseAfterApproval(true);
      return;
    }
    executeClose();
  };

  const portionYield = (yieldRaw * BigInt(percent)) / 100n;
  const portionDebt = (debtRaw * BigInt(percent)) / 100n;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">{percent === 100 ? "Position Closed" : `Closed ${percent}%`}</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">
              {percent === 100
                ? `${yieldSymbol} collateral was withdrawn, debt repaid, and any leftover refunded`
                : `${percent}% of the position was closed; remainder stays open`}
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
                Flash-loans {debtSymbol} to repay debt, withdraws {yieldSymbol} collateral,
                swaps it back, and refunds any surplus.
              </p>

              {/* Percentage selector */}
              <div className="space-y-2">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Close Percentage
                </label>
                <div className="flex gap-2">
                  {PERCENTAGES.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPercent(p)}
                      className={`flex-1 h-10 font-mono font-bold text-sm transition-colors ${
                        percent === p
                          ? "bg-accent text-background shadow-[0_0_20px_rgba(176,196,255,0.2)]"
                          : "border border-accent/30 text-accent hover:bg-accent hover:text-background"
                      }`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Position summary */}
              <div className="technical-border bg-background p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Collateral</span>
                  <span className="font-mono">{Number(formatUnits(yieldRaw, yieldDecimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })} {yieldSymbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Debt</span>
                  <span className="font-mono">{Number(formatUnits(debtRaw, debtDecimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })} {debtSymbol}</span>
                </div>
                <hr className="border-border/50" />
                <div className="flex justify-between text-accent">
                  <span>Withdraw ({percent}%)</span>
                  <span className="font-mono">{Number(formatUnits(portionYield, yieldDecimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })} {yieldSymbol}</span>
                </div>
                <div className="flex justify-between text-accent">
                  <span>Repay ({percent}%)</span>
                  <span className="font-mono">{Number(formatUnits(portionDebt, debtDecimals)).toLocaleString("en-US", { maximumFractionDigits: 6 })} {debtSymbol}</span>
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
                {needsApproval ? `Approve a${yieldSymbol}` : `Close ${percent}%`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
