"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { useIsolatedPosition } from "@/hooks/useUserIsolatedPositions";
import { explorerToastAction } from "@/lib/explorer";
import { planIsolatedRepay } from "@/lib/approvals";
import { QUERY } from "@/lib/queryPolicy";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isValidDecimalInput, safeParseUnits } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";

const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });

type RepayParams = { repayAll: boolean; input: bigint };

/**
 * Borrower-side repayment: LightlendPair.repayAsset(shares, borrower). Share-based: the pair pulls
 * the shares' value as of the repay block, so the typed amount is only an estimate. Every repay
 * approves ceil(currentShareValue × 1.001) + 1 (R1-5, R2-1). MAX sets a "repay all" intent that
 * repays the user's CURRENT borrow shares (re-derived on every render, Codex #8); everything is
 * re-checked against the chain after the approval (#6).
 */
export function IsolatedRepayModal({ pair, onClose }: { pair: `0x${string}`; onClose: () => void }) {
  const info = useIsolatedPair(pair);
  const position = useIsolatedPosition(pair);
  const [amount, setAmount] = useState("");
  const [repayAll, setRepayAll] = useState(false);
  const [submittedAll, setSubmittedAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();

  const asset = info?.asset;
  const assetSymbol = info?.assetSymbol ?? "";
  const assetDecimals = info?.assetDecimals ?? 18;
  const borrowedShares = position?.borrowedShares ?? 0n;
  const borrowedAmount = position?.borrowedAssets;
  const wallet = useWalletBalance(asset);
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const shownAmount = repayAll && borrowedAmount !== undefined ? formatUnits(borrowedAmount, assetDecimals) : amount;

  // Partial: shares for the typed amount (rounded down, previewing interest).
  const sharesPreview = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowShares",
    args: [parsed, false, true],
    query: { enabled: parsed > 0n && !repayAll, ...QUERY.user },
  });
  const sharesForInput = sharesPreview.data as bigint | undefined;
  const shares = repayAll ? borrowedShares : (sharesForInput ?? 0n);

  // Current value of exactly those shares (rounded up, previewing interest): the R2-1 assetValue.
  const shareValueRead = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowAmount",
    args: [shares, true, true],
    query: { enabled: shares > 0n, ...QUERY.user },
  });
  const shareValue = shareValueRead.data as bigint | undefined;

  const plan =
    shares > 0n && shareValue !== undefined && shareValue > 0n
      ? planIsolatedRepay({ full: repayAll, borrowedShares, sharesForInput: sharesForInput ?? 0n, shareValue })
      : null;
  const walletRaw = wallet.value;
  const insufficientWallet = plan !== null && walletRaw !== undefined && plan.assetValue > walletRaw;

  const sendRepay = async (params: RepayParams) => {
    if (!address) return;
    setNotice(null);
    // Shares to repay from the latest polled position (all of them for "repay all").
    const sharesNow = params.repayAll ? (position?.borrowedShares ?? 0n) : (sharesForInput ?? 0n);
    if (sharesNow === 0n) {
      setNotice("Nothing left to repay.");
      return;
    }
    const [valueNow, walletNow, allowanceNow] = await Promise.all([
      shareValueRead.refetch().then((r) => r.data as bigint | undefined),
      wallet.fetchNow(),
      flow.refetchAllowance(),
    ]);
    if (valueNow === undefined || walletNow === undefined || allowanceNow === undefined) {
      setNotice("Could not re-read the debt, wallet or allowance; nothing was sent.");
      return;
    }
    if (walletNow < valueNow) {
      setNotice(`Your wallet (${fmt(walletNow, assetDecimals)} ${assetSymbol}) no longer covers the current value of these shares (${fmt(valueNow, assetDecimals)} ${assetSymbol}).`);
      return;
    }
    if (allowanceNow < valueNow) {
      setNotice("The shares' value grew past the approved amount; approve again.");
      return;
    }
    setSubmittedAll(params.repayAll);
    await send({ address: pair, abi: ISOLATED_PAIR_ABI, functionName: "repayAsset", args: [sharesNow, address] });
  };

  const flow = useApprovalFlow<RepayParams>({
    token: asset ?? pair,
    spender: asset ? pair : null,
    paramsKey: repayAll ? "all" : amount,
    onProceed: sendRepay,
  });
  const needsApproval = plan !== null && flow.needsApproval(plan.approve);

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    const e = error ?? flow.error;
    if (e && e !== prevError.current) {
      prevError.current = e;
      toast.error("Repay failed", { description: parseErrorMessage(e) });
    }
  }, [error, flow.error]);
  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Debt repaid", { action: explorerToastAction(hash, "View") });
    }
  }, [isSuccess, hash]);

  const handleRepay = () => {
    if (!address || !plan) return;
    const params = { repayAll, input: parsed };
    if (needsApproval) {
      void flow.start(params, plan.approve);
      return;
    }
    void sendRepay(params);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Repaid {submittedAll ? "all" : `~${amount}`} {assetSymbol}</DialogTitle>
            </DialogHeader>
            <PostTxAllowance refetch={flow.refetchAllowance} symbol={assetSymbol} decimals={assetDecimals} spenderLabel="pair" />
            <Button variant="link" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Repay {assetSymbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Pay back {assetSymbol} to settle your debt in this isolated pair.</p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Debt: <span className="font-mono">{borrowedAmount === undefined ? "—" : fmt(borrowedAmount, assetDecimals)}</span> {assetSymbol}
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
                        setRepayAll(false);
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
                    disabled={borrowedShares === 0n}
                    onClick={() => {
                      setRepayAll(true);
                      setAmount(borrowedAmount !== undefined ? formatUnits(borrowedAmount, assetDecimals) : "");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1" data-testid="share-estimate">
                  {repayAll
                    ? "Repay all: all your borrow shares; the pair takes their value at execution."
                    : "Estimate: repays the shares this amount buys now; the pair takes their value at execution, which grows with accrual (covered by the 0.1% buffer)."}
                </p>
                {plan && (
                  <p className="text-xs font-mono text-muted-foreground">
                    {plan.shares.toString()} shares ≈ {fmt(plan.assetValue, assetDecimals)} {assetSymbol} now
                  </p>
                )}
                {insufficientWallet && <p className="text-xs text-destructive mt-1">Insufficient {assetSymbol} balance for the current value</p>}
                {notice && <p className="text-xs text-amber-400 mt-1">{notice}</p>}
                {flow.cancelReason && <p className="text-xs text-amber-400 mt-1">Approval flow cancelled: {flow.cancelReason}.</p>}
              </div>

              <AllowanceNote
                symbol={assetSymbol}
                decimals={assetDecimals}
                spenderLabel="pair"
                allowance={flow.allowance}
                approveAmount={plan && needsApproval ? plan.approve : undefined}
                expectedPull={plan?.assetValue}
                buffered
              />

              <TxButton
                onClick={handleRepay}
                isPending={isPending || flow.isPending}
                isSimulating={isSimulating || flow.isSimulating}
                isConfirming={isConfirming || flow.isConfirming || flow.awaitingApproval}
                disabled={!address || !plan || walletRaw === undefined || insufficientWallet}
              >
                {needsApproval ? `Approve ${assetSymbol}` : `Repay ${assetSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
