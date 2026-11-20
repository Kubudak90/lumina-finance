"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { useIsolatedPosition } from "@/hooks/useUserIsolatedPositions";
import { useGuardStatus } from "@/hooks/useGuardStatus";
import { explorerToastAction } from "@/lib/explorer";
import { exactApproval } from "@/lib/approvals";
import { isolatedBorrowMaxFromReads, isolatedLtv } from "@/lib/borrowMax";
import { GUARD_BLOCKED_NOTE } from "@/lib/guard";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { GuardNotice } from "@/components/common/GuardNotice";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isValidDecimalInput, safeParseUnits } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";

const fmt = (value: bigint, decimals: number, max = 4) =>
  Number(formatUnits(value, decimals)).toLocaleString("en-US", { maximumFractionDigits: max });

type BorrowParams = { borrow: bigint; collateral: bigint };

/**
 * Post collateral (exact approval) and borrow in one transaction. Everything risk-related — the
 * pair's rate, maxLTV, liquidity, the guard and the user's debt — is re-derived from the polled
 * data on every render and re-checked after the approval (Codex #8). MAX uses the pair's maxLTV and
 * oracle exchange rate with a 99% haircut (FE-05) and is "unavailable" when an input is missing.
 */
export function IsolatedBorrowModal({ pair, onClose }: { pair: `0x${string}`; onClose: () => void }) {
  const info = useIsolatedPair(pair);
  const position = useIsolatedPosition(pair);
  const guard = useGuardStatus();
  const [collateralInput, setCollateralInput] = useState("");
  const [borrowInput, setBorrowInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();

  const assetSymbol = info?.assetSymbol ?? "";
  const assetDecimals = info?.assetDecimals ?? 18;
  const collateral = info?.collateral;
  const collateralSymbol = info?.collateralSymbol ?? "";
  const collateralDecimals = info?.collateralDecimals ?? 18;
  const wallet = useWalletBalance(collateral);
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsedCollateral = collateralInput ? (safeParseUnits(collateralInput, collateralDecimals) ?? 0n) : 0n;
  const parsedBorrow = borrowInput ? (safeParseUnits(borrowInput, assetDecimals) ?? 0n) : 0n;
  const collateralBalanceRaw = wallet.value;
  const collateralBalanceFmt = collateralBalanceRaw === undefined ? "" : formatUnits(collateralBalanceRaw, collateralDecimals);

  const currentCollateral = position?.collateralAmount ?? 0n;
  // No position yet = no debt; a position whose debt conversion failed = unknown.
  const currentDebt = position ? position.borrowedAssets : 0n;
  const rate = info?.exchangeRate;
  const borrowBlocked = !guard.borrowAllowed || info?.oracleBadData !== false;

  const maxFor = (extraCollateral: bigint) =>
    isolatedBorrowMaxFromReads({
      collateral: currentCollateral + extraCollateral,
      currentDebt,
      exchangeRate: rate,
      maxLtv: info?.maxLTV,
      availableLiquidity: info?.availableLiquidity,
      borrowLimit: info?.borrowLimit,
      totalBorrow: info?.totalBorrowAmount,
    });
  const maxBorrow = maxFor(parsedCollateral);

  const ltvAfter =
    rate !== undefined && currentDebt !== undefined
      ? isolatedLtv(currentDebt + parsedBorrow, currentCollateral + parsedCollateral, rate)
      : null;
  const ltvPercent = ltvAfter === null ? "—" : `${(Number(ltvAfter) / 1000).toFixed(2)}%`;
  const maxLtvPercent = info?.maxLTV === undefined ? "—" : `${(Number(info.maxLTV) / 1000).toFixed(2)}%`;
  const overMax = maxBorrow !== null && parsedBorrow > maxBorrow;
  const insufficientCollateral = collateralBalanceRaw !== undefined && parsedCollateral > collateralBalanceRaw;

  const sendBorrow = async (params: BorrowParams) => {
    if (!address) return;
    setNotice(null);
    // Re-check with the latest polled data (this closure is from the latest render).
    if (borrowBlocked) {
      setNotice(`Borrowing became blocked; nothing was sent. ${GUARD_BLOCKED_NOTE.isolated}`);
      return;
    }
    const maxNow = maxFor(params.collateral);
    if (maxNow === null || params.borrow > maxNow) {
      setNotice("The borrow no longer fits the pair's limits at the current rate; nothing was sent.");
      return;
    }
    if (params.collateral > 0n) {
      const walletNow = await wallet.fetchNow();
      if (walletNow === undefined || walletNow < params.collateral) {
        setNotice("Your collateral balance no longer covers the amount; nothing was sent.");
        return;
      }
    }
    await send({
      address: pair,
      abi: ISOLATED_PAIR_ABI,
      functionName: "borrowAsset",
      args: [params.borrow, params.collateral, address],
    });
  };

  const flow = useApprovalFlow<BorrowParams>({
    token: collateral ?? pair,
    spender: collateral ? pair : null,
    paramsKey: `${collateralInput}|${borrowInput}`,
    onProceed: sendBorrow,
  });
  const needsCollateralApproval = parsedCollateral > 0n && flow.needsApproval(parsedCollateral);

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    const e = error ?? flow.error;
    if (e && e !== prevError.current) {
      prevError.current = e;
      toast.error("Borrow failed", { description: parseErrorMessage(e) });
    }
  }, [error, flow.error]);
  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Borrow successful", { description: `Borrowed ${borrowInput} ${assetSymbol}`, action: explorerToastAction(hash, "View") });
    }
  }, [isSuccess, hash, borrowInput, assetSymbol]);

  const handleBorrow = () => {
    if (!address || parsedBorrow === 0n) return;
    const params = { borrow: parsedBorrow, collateral: parsedCollateral };
    if (needsCollateralApproval) {
      // Add-collateral approves exactly the collateral posted (FE-04).
      void flow.start(params, exactApproval(parsedCollateral));
      return;
    }
    void sendBorrow(params);
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
            <p className="text-muted-foreground mt-2 mb-4">Borrowed {borrowInput} {assetSymbol}</p>
            {parsedCollateral > 0n && (
              <PostTxAllowance refetch={flow.refetchAllowance} symbol={collateralSymbol} decimals={collateralDecimals} spenderLabel="pair" />
            )}
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Borrow {assetSymbol} (collateral: {collateralSymbol})</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <GuardNotice venue="isolated" />
              {borrowBlocked && info?.oracleBadData === undefined && (
                <p className="text-xs text-amber-400">Pair oracle unavailable; borrowing is disabled. {GUARD_BLOCKED_NOTE.isolated}</p>
              )}
              <p className="text-sm text-muted-foreground">
                Post {collateralSymbol} as collateral and borrow {assetSymbol} in one transaction. Max LTV in this pair is {maxLtvPercent}.
              </p>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Add collateral ({collateralSymbol})</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{collateralBalanceRaw === undefined ? "—" : Number(collateralBalanceFmt).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {collateralSymbol}
                  </span>
                </div>
                <Input
                  aria-label="Collateral"
                  type="number"
                  value={collateralInput}
                  onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, collateralDecimals) && Number(v) >= 0)) setCollateralInput(v); }}
                  placeholder="0.00"
                  min="0"
                  step="any"
                  className="h-12 text-lg bg-transparent border-border font-mono"
                />
                {currentCollateral > 0n && (
                  <p className="text-xs text-muted-foreground mt-1">Already posted: {fmt(currentCollateral, collateralDecimals)} {collateralSymbol}</p>
                )}
                {insufficientCollateral && <p className="text-xs text-destructive mt-1">Insufficient {collateralSymbol} balance</p>}
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Borrow ({assetSymbol})</label>
                  <span className="text-sm text-muted-foreground">
                    Max (99%):{" "}
                    <span className="font-mono" data-testid="borrow-max">
                      {maxBorrow === null ? "unavailable" : `${fmt(maxBorrow, assetDecimals)} ${assetSymbol}`}
                    </span>
                  </span>
                </div>
                <div className="relative">
                  <Input
                    aria-label="Borrow"
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
                    disabled={maxBorrow === null}
                    onClick={() => maxBorrow !== null && setBorrowInput(formatUnits(maxBorrow, assetDecimals))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {overMax && parsedBorrow > 0n && <p className="text-xs text-destructive mt-1">Exceeds max LTV, pair liquidity or borrow limit</p>}
                {notice && <p className="text-xs text-amber-400 mt-1">{notice}</p>}
                {flow.cancelReason && <p className="text-xs text-amber-400 mt-1">Approval flow cancelled: {flow.cancelReason}.</p>}
              </div>

              <div className="technical-border bg-background p-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">LTV after borrow (pair oracle)</span>
                  <span className={`font-mono ${overMax ? "text-rose-400" : "text-emerald-400"}`}>{ltvPercent}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Pair liquidity</span>
                  <span className="font-mono">
                    {info?.availableLiquidity === undefined ? "unavailable" : `${fmt(info.availableLiquidity, assetDecimals)} ${assetSymbol}`}
                  </span>
                </div>
              </div>

              {parsedCollateral > 0n && (
                <AllowanceNote
                  symbol={collateralSymbol}
                  decimals={collateralDecimals}
                  spenderLabel="pair"
                  allowance={flow.allowance}
                  approveAmount={needsCollateralApproval ? parsedCollateral : undefined}
                />
              )}

              <TxButton
                onClick={handleBorrow}
                isPending={isPending || flow.isPending}
                isSimulating={isSimulating || flow.isSimulating}
                isConfirming={isConfirming || flow.isConfirming || flow.awaitingApproval}
                disabled={!address || !info || parsedBorrow === 0n || insufficientCollateral || overMax || maxBorrow === null || borrowBlocked}
              >
                {borrowBlocked ? "Borrowing blocked" : needsCollateralApproval ? `Approve ${collateralSymbol}` : `Borrow ${assetSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
