"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { explorerToastAction } from "@/lib/explorer";
import { exactApproval } from "@/lib/approvals";
import { isolatedBorrowMax, isolatedLtv } from "@/lib/borrowMax";
import { GUARD_BLOCKED_NOTE } from "@/lib/guard";
import { QUERY } from "@/lib/queryPolicy";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { GuardNotice } from "@/components/common/GuardNotice";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import type { IsolatedPairInfo } from "@/hooks/useIsolatedPairs";
import type { UserIsolatedPosition } from "@/hooks/useUserIsolatedPositions";
import { ERC20_ABI, ISOLATED_PAIR_ABI } from "@/lib/abis";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isValidDecimalInput, safeParseUnits } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";

interface IsolatedBorrowModalProps {
  pair: IsolatedPairInfo & { pair: `0x${string}` };
  /** The user's current position in this pair, if any. */
  position?: UserIsolatedPosition;
  onClose: () => void;
}

const fmt = (value: bigint, decimals: number, max = 4) =>
  Number(formatUnits(value, decimals)).toLocaleString("en-US", { maximumFractionDigits: max });

/**
 * Post collateral (exact approval) and borrow in one transaction. MAX uses the pair's maxLTV and
 * its oracle exchange rate with a 99% haircut, capped by pair liquidity and borrow limit (FE-05).
 */
export function IsolatedBorrowModal({ pair: info, position, onClose }: IsolatedBorrowModalProps) {
  const { pair, assetSymbol, assetDecimals, collateral, collateralSymbol, collateralDecimals, maxLTV } = info;
  const [collateralInput, setCollateralInput] = useState("");
  const [borrowInput, setBorrowInput] = useState("");
  const [pendingBorrowAfterApproval, setPendingBorrowAfterApproval] = useState(false);
  const pendingArgsRef = useRef<{ borrow: bigint; collateral: bigint } | null>(null);

  const { address } = useAccount();
  const collateralApproval = useTokenApproval(collateral, pair, address);

  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsedCollateral = collateralInput ? (safeParseUnits(collateralInput, collateralDecimals) ?? 0n) : 0n;
  const parsedBorrow = borrowInput ? (safeParseUnits(borrowInput, assetDecimals) ?? 0n) : 0n;

  const collateralBalance = useLuminaReadContract({
    address: collateral,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, ...QUERY.user },
  });
  const collateralBalanceRaw = (collateralBalance.data as bigint | undefined) ?? 0n;
  const collateralBalanceFmt = formatUnits(collateralBalanceRaw, collateralDecimals);

  const currentCollateral = position?.collateralAmount ?? 0n;
  const currentDebt = position?.borrowedAssets ?? 0n;
  const totalCollateral = currentCollateral + parsedCollateral;
  const rate = info.exchangeRate;
  const borrowBlocked = info.oracleBadData !== false;

  const maxBorrow =
    rate !== undefined
      ? isolatedBorrowMax({
          collateral: totalCollateral,
          currentDebt,
          exchangeRate: rate,
          maxLtv: maxLTV,
          availableLiquidity: info.availableLiquidity,
          borrowLimit: info.borrowLimit,
          totalBorrow: info.totalBorrowAmount,
        })
      : 0n;

  // LTV after this borrow at the pair oracle's rate (FE-11: decimals-correct).
  const ltvAfter = rate !== undefined ? isolatedLtv(currentDebt + parsedBorrow, totalCollateral, rate) : null;
  const ltvPercent = ltvAfter === null ? "—" : `${(Number(ltvAfter) / 1000).toFixed(2)}%`;
  const maxLtvPercent = (Number(maxLTV) / 1000).toFixed(2);
  const overMax = parsedBorrow > maxBorrow;
  const insufficientCollateral = parsedCollateral > collateralBalanceRaw;

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Borrow failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Borrow successful", {
        description: `Borrowed ${borrowInput} ${assetSymbol}`,
        action: explorerToastAction(hash, "View"),
      });
    }
  }, [isSuccess, hash, borrowInput, assetSymbol]);

  useEffect(() => {
    setPendingBorrowAfterApproval(false);
  }, [collateralInput, borrowInput]);

  useEffect(() => {
    if (collateralApproval.isSuccess && pendingBorrowAfterApproval && pendingArgsRef.current) {
      setPendingBorrowAfterApproval(false);
      if (!address) return;
      void send({
        address: pair,
        abi: ISOLATED_PAIR_ABI,
        functionName: "borrowAsset",
        args: [pendingArgsRef.current.borrow, pendingArgsRef.current.collateral, address],
      });
    }
  }, [collateralApproval.isSuccess, pendingBorrowAfterApproval, pair, address, send]);

  const needsCollateralApproval = parsedCollateral > 0n && collateralApproval.needsApproval(parsedCollateral);

  const handleBorrow = () => {
    if (!address || parsedBorrow === 0n) return;
    if (needsCollateralApproval) {
      pendingArgsRef.current = { borrow: parsedBorrow, collateral: parsedCollateral };
      collateralApproval.approve(exactApproval(parsedCollateral));
      setPendingBorrowAfterApproval(true);
      return;
    }
    void send({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "borrowAsset",
      args: [parsedBorrow, parsedCollateral, address],
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
            <p className="text-muted-foreground mt-2 mb-4">
              Borrowed {borrowInput} {assetSymbol}
              {parsedCollateral > 0n ? ` against ${collateralInput} more ${collateralSymbol}` : ""}
            </p>
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Borrow {assetSymbol} (collateral: {collateralSymbol})</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <GuardNotice venue="isolated" />
              {borrowBlocked && info.oracleBadData === undefined && (
                <p className="text-xs text-amber-400">Pair oracle unavailable; borrowing is disabled. {GUARD_BLOCKED_NOTE.isolated}</p>
              )}
              <p className="text-sm text-muted-foreground">
                Post {collateralSymbol} as collateral and borrow {assetSymbol} in one transaction.
                Max LTV in this pair is {maxLtvPercent}%.
              </p>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Add collateral ({collateralSymbol})</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{Number(collateralBalanceFmt).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {collateralSymbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    value={collateralInput}
                    onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, collateralDecimals) && Number(v) >= 0)) setCollateralInput(v); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setCollateralInput(collateralBalanceFmt)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {currentCollateral > 0n && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Already posted: {fmt(currentCollateral, collateralDecimals)} {collateralSymbol}
                  </p>
                )}
                {insufficientCollateral && (
                  <p className="text-xs text-destructive mt-1">Insufficient {collateralSymbol} balance</p>
                )}
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Borrow ({assetSymbol})</label>
                  <span className="text-sm text-muted-foreground">
                    Max (99%): <span className="font-mono">{fmt(maxBorrow, assetDecimals)}</span> {assetSymbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    type="number"
                    value={borrowInput}
                    onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, assetDecimals) && Number(v) >= 0)) setBorrowInput(v); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setBorrowInput(formatUnits(maxBorrow, assetDecimals))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {overMax && parsedBorrow > 0n && (
                  <p className="text-xs text-destructive mt-1">Exceeds max LTV, pair liquidity or borrow limit</p>
                )}
              </div>

              <div className="technical-border bg-background p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">LTV after borrow (pair oracle)</span>
                  <span className={`font-mono ${overMax ? "text-rose-400" : "text-emerald-400"}`}>{ltvPercent}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Max LTV in pair</span>
                  <span className="font-mono">{maxLtvPercent}%</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Pair liquidity</span>
                  <span className="font-mono">{fmt(info.availableLiquidity, assetDecimals)} {assetSymbol}</span>
                </div>
              </div>

              {parsedCollateral > 0n && (
                <AllowanceNote
                  symbol={collateralSymbol}
                  decimals={collateralDecimals}
                  spenderLabel="pair"
                  allowance={collateralApproval.allowance}
                  approveAmount={needsCollateralApproval ? parsedCollateral : undefined}
                />
              )}

              <TxButton
                onClick={handleBorrow}
                isPending={isPending || collateralApproval.isPending}
                isSimulating={isSimulating || collateralApproval.isSimulating}
                isConfirming={isConfirming || collateralApproval.isConfirming}
                disabled={!address || parsedBorrow === 0n || insufficientCollateral || overMax || borrowBlocked}
              >
                {borrowBlocked
                  ? "Borrowing blocked"
                  : needsCollateralApproval
                    ? `Approve ${collateralSymbol}`
                    : `Borrow ${assetSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
