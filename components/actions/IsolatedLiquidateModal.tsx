"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { explorerToastAction } from "@/lib/explorer";
import { repayApproval } from "@/lib/approvals";
import { QUERY } from "@/lib/queryPolicy";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
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
  /** Live (polled) borrower data, re-derived by the page on every render. */
  borrowerDebtAsset: bigint | undefined;
  borrowerDebtShares: bigint;
  borrowerCollateral: bigint;
  onClose: () => void;
}

const fmt = (v: bigint, d: number, max = 6) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: max });

type LiquidateParams = { all: boolean; input: bigint };

/** `_deadline` argument: 30 minutes from now (called when sending, never during render). */
function liquidationDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
}

/**
 * LightlendPair.liquidate(_sharesToLiquidate, _deadline, _borrower). Like a repay this is
 * share-based: the pair pulls the shares' value after accruing interest, so the approval carries
 * the repay buffer — ceil(currentShareValue × 1.001) + 1 — and the wallet is checked against the
 * CURRENT share value, not the typed amount (Codex #6).
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
  const [all, setAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();
  const wallet = useWalletBalance(asset);
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const shownAmount = all && borrowerDebtAsset !== undefined ? formatUnits(borrowerDebtAsset, assetDecimals) : amount;

  const sharesPreview = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowShares",
    args: [parsed, false, true],
    query: { enabled: parsed > 0n && !all, ...QUERY.user },
  });
  const computedShares = sharesPreview.data as bigint | undefined;
  const sharesToLiquidate = all ? borrowerDebtShares : (computedShares ?? 0n);

  const shareValueRead = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowAmount",
    args: [sharesToLiquidate, true, true],
    query: { enabled: sharesToLiquidate > 0n, ...QUERY.user },
  });
  const shareValue = shareValueRead.data as bigint | undefined;
  const approveAmount = shareValue !== undefined && shareValue > 0n ? repayApproval(shareValue) : undefined;
  const walletRaw = wallet.value;
  // The pull is the shares' current value (it grows with accrual), not the typed amount.
  const insufficientWallet = shareValue !== undefined && walletRaw !== undefined && walletRaw < shareValue;

  const sendLiquidation = async (params: LiquidateParams) => {
    setNotice(null);
    const shares = params.all ? borrowerDebtShares : (computedShares ?? 0n);
    if (shares === 0n) return;
    const [valueNow, walletNow, allowanceNow] = await Promise.all([
      shareValueRead.refetch().then((r) => r.data as bigint | undefined),
      wallet.fetchNow(),
      flow.refetchAllowance(),
    ]);
    if (valueNow === undefined || walletNow === undefined || allowanceNow === undefined) {
      setNotice("Could not re-read the share value, wallet or allowance; nothing was sent.");
      return;
    }
    if (walletNow < valueNow) {
      setNotice(`Your wallet no longer covers the current value of these shares (${fmt(valueNow, assetDecimals)} ${assetSymbol}).`);
      return;
    }
    if (allowanceNow < valueNow) {
      setNotice("The shares' value grew past the approved amount; approve again.");
      return;
    }
    const deadline = liquidationDeadline();
    await send({ address: pair, abi: ISOLATED_PAIR_ABI, functionName: "liquidate", args: [shares, deadline, borrower] });
  };

  const flow = useApprovalFlow<LiquidateParams>({
    token: asset,
    spender: pair,
    paramsKey: `${borrower}|${all ? "all" : amount}`,
    onProceed: sendLiquidation,
  });
  const approvalNeeded = approveAmount !== undefined && flow.needsApproval(approveAmount);

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    const e = error ?? flow.error;
    if (e && e !== prevError.current) {
      prevError.current = e;
      toast.error("Liquidate failed", { description: parseErrorMessage(e) });
    }
  }, [error, flow.error]);
  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Liquidation successful", { description: `Received ${collateralSymbol} collateral`, action: explorerToastAction(hash, "View") });
    }
  }, [isSuccess, hash, collateralSymbol]);

  const handleLiquidate = () => {
    if (!address || sharesToLiquidate === 0n || approveAmount === undefined) return;
    const params = { all, input: parsed };
    if (approvalNeeded) {
      void flow.start(params, approveAmount);
      return;
    }
    void sendLiquidation(params);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Liquidation Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground">Repaid part of {truncateAddress(borrower)}&apos;s debt; received {collateralSymbol}.</p>
            <PostTxAllowance refetch={flow.refetchAllowance} symbol={assetSymbol} decimals={assetDecimals} spenderLabel="pair" />
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
                  <span className="font-mono">{borrowerDebtAsset === undefined ? "unavailable" : `${fmt(borrowerDebtAsset, assetDecimals)} ${assetSymbol}`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collateral</span>
                  <span className="font-mono">{fmt(borrowerCollateral, collateralDecimals, 4)} {collateralSymbol}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Pay {assetSymbol} to settle part or all of the borrower&apos;s debt and receive {collateralSymbol} (with discount).
                The pair reverts if the borrower is solvent at execution time.
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount to Repay ({assetSymbol})</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{walletRaw === undefined ? "—" : fmt(walletRaw, assetDecimals, 4)}</span>
                  </span>
                </div>
                <div className="relative">
                  <Input
                    aria-label="Amount"
                    type="number"
                    value={shownAmount}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || (isValidDecimalInput(v, assetDecimals) && Number(v) >= 0)) {
                        setAll(false);
                        setAmount(v);
                      }
                    }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    disabled={borrowerDebtShares === 0n}
                    onClick={() => setAll(true)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {shareValue !== undefined && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Estimate: {sharesToLiquidate.toString()} shares, currently {fmt(shareValue, assetDecimals)} {assetSymbol}; the pair takes their value at execution.
                  </p>
                )}
                {insufficientWallet && <p className="text-xs text-destructive mt-1">Insufficient {assetSymbol} balance for the current share value</p>}
                {notice && <p className="text-xs text-amber-400 mt-1">{notice}</p>}
                {flow.cancelReason && <p className="text-xs text-amber-400 mt-1">Approval flow cancelled: {flow.cancelReason}.</p>}
              </div>
              <AllowanceNote
                symbol={assetSymbol}
                decimals={assetDecimals}
                spenderLabel="pair"
                allowance={flow.allowance}
                approveAmount={approvalNeeded ? approveAmount : undefined}
                expectedPull={shareValue}
                buffered
              />
              <TxButton
                onClick={handleLiquidate}
                isPending={isPending || flow.isPending}
                isSimulating={isSimulating || flow.isSimulating}
                isConfirming={isConfirming || flow.isConfirming || flow.awaitingApproval}
                disabled={!address || sharesToLiquidate === 0n || walletRaw === undefined || insufficientWallet || borrowerDebtShares === 0n || approveAmount === undefined}
              >
                {approvalNeeded ? `Approve ${assetSymbol}` : "Liquidate"}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
