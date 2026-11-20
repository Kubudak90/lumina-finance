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
import { useIsolatedFreshReads } from "@/hooks/useIsolatedFreshReads";
import { explorerToastAction } from "@/lib/explorer";
import { hasExecutionHeadroom, planIsolatedRepay, repayHeadroom, walletBoundedShares } from "@/lib/approvals";
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

/** "all": every borrow share at send time; "shares": exactly `shares` (typed amount or wallet offer). */
type RepayParams = { mode: "all" } | { mode: "shares"; shares: bigint };
type Intent = { kind: "amount" } | { kind: "all" } | { kind: "shares"; shares: bigint };

/**
 * Borrower-side repayment: LightlendPair.repayAsset(shares, borrower). Share-based: the pair pulls
 * the shares' value as of the repay block, so the typed amount is only an estimate.
 * - Every repay approves ceil(currentShareValue × 1.001) + 1 (R1-5, R2-1).
 * - Wallet and allowance must hold the execution headroom ceil(value × 1.0005) + 1 before sending;
 *   a short wallet is offered the largest share repay it covers (Gemini r2 C1/M1).
 * - Typed shares above the borrow shares are refused (M2).
 * - Right before sending, the position, allowance, wallet and share value are read from the chain,
 *   not the poll cache, and the repay is re-planned from them (M3).
 */
export function IsolatedRepayModal({ pair, onClose }: { pair: `0x${string}`; onClose: () => void }) {
  const info = useIsolatedPair(pair);
  const positionState = useIsolatedPosition(pair);
  const position = positionState.position;
  const [amount, setAmount] = useState("");
  const [intent, setIntent] = useState<Intent>({ kind: "amount" });
  const [submittedAll, setSubmittedAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();
  const fresh = useIsolatedFreshReads();

  const asset = info?.asset;
  const assetSymbol = info?.assetSymbol ?? "";
  const assetDecimals = info?.assetDecimals ?? 18;
  const borrowedShares = position?.borrowedShares ?? 0n;
  const borrowedAmount = position?.borrowedAssets;
  const wallet = useWalletBalance(asset);
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const shownAmount = intent.kind === "all" && borrowedAmount !== undefined ? formatUnits(borrowedAmount, assetDecimals) : amount;

  // Typed amount: shares it buys now (rounded down, previewing interest), by the contract.
  const sharesPreview = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowShares",
    args: [parsed, false, true],
    query: { enabled: parsed > 0n && intent.kind === "amount", ...QUERY.user },
  });
  const sharesForInput = sharesPreview.data as bigint | undefined;
  const shares =
    intent.kind === "all" ? borrowedShares : intent.kind === "shares" ? intent.shares : (sharesForInput ?? 0n);
  const overShares = intent.kind !== "all" && shares > borrowedShares;

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
    shares > 0n && !overShares && shareValue !== undefined && shareValue > 0n
      ? planIsolatedRepay({ full: intent.kind === "all", borrowedShares, sharesForInput: shares, shareValue })
      : null;
  const walletRaw = wallet.value;
  const walletShort = plan !== null && walletRaw !== undefined && walletRaw < repayHeadroom(plan.assetValue);
  const offerShares =
    walletShort && walletRaw !== undefined && info?.totalBorrowAmount !== undefined && info.totalBorrowShares !== undefined
      ? walletBoundedShares(walletRaw, { amount: info.totalBorrowAmount, shares: info.totalBorrowShares }, borrowedShares)
      : 0n;

  const sendRepay = async (params: RepayParams) => {
    if (!address || !asset) return;
    setNotice(null);
    try {
      // From the chain, not the poll cache.
      const state = await fresh.accountState(pair, address, asset, address);
      const sharesNow = params.mode === "all" ? state.borrowShares : params.shares;
      if (sharesNow === 0n || state.borrowShares === 0n) {
        setNotice("Nothing left to repay.");
        return;
      }
      if (sharesNow > state.borrowShares) {
        setNotice(`You now owe ${state.borrowShares.toString()} shares, fewer than the ${sharesNow.toString()} selected; nothing was sent.`);
        return;
      }
      const valueNow = await fresh.shareValue(pair, sharesNow);
      if (!hasExecutionHeadroom({ allowance: state.allowance, wallet: state.wallet, value: valueNow })) {
        setNotice(
          state.wallet < repayHeadroom(valueNow)
            ? `Your wallet (${fmt(state.wallet, assetDecimals)} ${assetSymbol}) no longer covers these shares (${fmt(valueNow, assetDecimals)} ${assetSymbol}) plus the accrual margin; nothing was sent.`
            : "The shares' value grew past the approved amount; approve again.",
        );
        return;
      }
      setSubmittedAll(params.mode === "all");
      await send({ address: pair, abi: ISOLATED_PAIR_ABI, functionName: "repayAsset", args: [sharesNow, address] });
    } catch (err) {
      setNotice(`Re-check failed (${(err as Error).message}); nothing was sent.`);
    }
  };

  const paramsKey = intent.kind === "all" ? "all" : intent.kind === "shares" ? `shares:${intent.shares}` : amount;
  const flow = useApprovalFlow<RepayParams>({
    token: asset ?? pair,
    spender: asset ? pair : null,
    paramsKey,
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
    const params: RepayParams = intent.kind === "all" ? { mode: "all" } : { mode: "shares", shares: plan.shares };
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
              {positionState.status === "unknown" && (
                <p className="text-xs text-amber-400">Your position could not be read; repaying is disabled until it loads.</p>
              )}
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
                    value={intent.kind === "shares" ? "" : shownAmount}
                    placeholder={intent.kind === "shares" ? `${intent.shares.toString()} shares` : "0.00"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || (isValidDecimalInput(v, assetDecimals) && Number(v) >= 0)) {
                        setIntent({ kind: "amount" });
                        setAmount(v);
                      }
                    }}
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    disabled={borrowedShares === 0n}
                    onClick={() => {
                      setIntent({ kind: "all" });
                      setAmount(borrowedAmount !== undefined ? formatUnits(borrowedAmount, assetDecimals) : "");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1" data-testid="share-estimate">
                  {intent.kind === "all"
                    ? "Repay all: all your borrow shares; the pair takes their value at execution."
                    : "Estimate: repays the shares this amount buys now; the pair takes their value at execution, which grows with accrual (covered by the 0.1% buffer)."}
                </p>
                {plan && (
                  <p className="text-xs font-mono text-muted-foreground">
                    {plan.shares.toString()} shares ≈ {fmt(plan.assetValue, assetDecimals)} {assetSymbol} now
                  </p>
                )}
                {overShares && (
                  <p className="text-xs text-destructive mt-1" data-testid="share-bound-error">
                    That is more than your debt ({borrowedShares.toString()} shares); use MAX to repay everything.
                  </p>
                )}
                {walletShort && (
                  <div className="text-xs text-amber-400 mt-1 space-y-1" data-testid="wallet-offer">
                    <p>Your wallet does not cover these shares plus the accrual margin.</p>
                    {offerShares > 0n && (
                      <button type="button" className="underline" onClick={() => setIntent({ kind: "shares", shares: offerShares })}>
                        Repay {offerShares.toString()} shares instead (what your wallet covers)
                      </button>
                    )}
                  </div>
                )}
                {notice && <p className="text-xs text-amber-400 mt-1" data-testid="repay-notice">{notice}</p>}
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
                disabled={!address || positionState.status !== "known" || !plan || walletRaw === undefined || walletShort || overShares}
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
