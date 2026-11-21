"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { useIsolatedPosition } from "@/hooks/useUserIsolatedPositions";
import { useIsolatedFreshReads } from "@/hooks/useIsolatedFreshReads";
import { hasExecutionHeadroom, planIsolatedRepay, repayHeadroom, walletBoundedShares } from "@/lib/approvals";
import { abortFollowUp, type FollowUpAbort } from "@/lib/approvalFlow";
import { aprToApy, isolatedPreview, type IsolatedAction } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { QUERY } from "@/lib/queryPolicy";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { safeParseUnits } from "@/lib/format";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { AmountField, TxDialog, TxForm, TxNotice, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { IsolatedRiskSummary } from "@/components/tx/TxSummary";
import { TxSteps } from "@/components/tx/TxSteps";
import { TxDetails } from "@/components/tx/TxDetails";
import { IsolatedAfterState, previewCall } from "@/components/tx/AfterStates";
import { useIsolatedAccountRead } from "@/components/tx/reads";
import { formatAmount, formatToken } from "@/components/tx/format";
import { isolatedSides } from "@/components/tx/isolated";

/** "all": every borrow share at send time; "shares": exactly `shares` (typed amount or wallet offer). */
type RepayParams = { mode: "all" } | { mode: "shares"; shares: bigint };
type Intent = { kind: "amount" } | { kind: "all" } | { kind: "shares"; shares: bigint };

const CTX: TxErrorContext = { venue: "isolated", action: "repay" };

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
  const tx = useLuminaWrite();
  const read = useIsolatedAccountRead(pair, info?.dualOracle, address);
  const sides = isolatedSides(info);

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

  const repayRequest = (sharesArg: bigint) => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "repayAsset",
    args: [sharesArg, address],
  });

  const stop = (text: string, reason: string, reapprove = false) => {
    setNotice(text);
    return abortFollowUp(reason, reapprove);
  };

  const sendRepay = async (params: RepayParams): Promise<FollowUpAbort | void> => {
    if (!address || !asset) return;
    setNotice(null);
    try {
      // From the chain, not the poll cache.
      const state = await fresh.accountState(pair, address, asset, address);
      const sharesNow = params.mode === "all" ? state.borrowShares : params.shares;
      if (sharesNow === 0n || state.borrowShares === 0n) return stop("Nothing left to repay.", "nothing left to repay");
      if (sharesNow > state.borrowShares) {
        return stop(
          `You now owe ${state.borrowShares.toString()} shares, fewer than the ${sharesNow.toString()} selected; nothing was sent.`,
          "the debt is now smaller than the selected shares",
        );
      }
      const valueNow = await fresh.shareValue(pair, sharesNow);
      if (!hasExecutionHeadroom({ allowance: state.allowance, wallet: state.wallet, value: valueNow })) {
        const walletShortNow = state.wallet < repayHeadroom(valueNow);
        return stop(
          walletShortNow
            ? `Your wallet (${formatAmount(state.wallet, assetDecimals, 6)} ${assetSymbol}) no longer covers these shares (${formatAmount(valueNow, assetDecimals, 6)} ${assetSymbol}) plus the accrual margin; nothing was sent.`
            : "The shares' value grew past the approved amount; approve again.",
          walletShortNow ? "the wallet no longer covers the shares' value" : "interest pushed the value past the approved headroom",
          !walletShortNow,
        );
      }
      setSubmittedAll(params.mode === "all");
      await tx.send(repayRequest(sharesNow));
    } catch (err) {
      return stop(`Re-check failed (${(err as Error).message}); nothing was sent.`, "the re-check could not read the chain");
    }
  };

  const paramsKey = intent.kind === "all" ? "all" : intent.kind === "shares" ? `shares:${intent.shares}` : amount;
  const flow = useApprovalFlow<RepayParams>({
    token: asset ?? pair,
    spender: asset ? pair : null,
    paramsKey,
    onProceed: sendRepay,
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });
  const needsApproval = plan !== null && flow.needsApproval(plan.approve);

  useTxErrorToast(tx.error, "Repay failed", CTX);
  useTxErrorToast(flow.error, "Approval failed", { venue: "isolated", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Debt repaid");

  const handleRepay = () => {
    if (!address || !plan) return;
    const params: RepayParams = intent.kind === "all" ? { mode: "all" } : { mode: "shares", shares: plan.shares };
    if (needsApproval) {
      void flow.start(params, plan.approve);
      return;
    }
    void flow.proceed(params);
  };

  // Share-based after-state (spec §3.1): the remaining shares at the previewed post-repay totals.
  const action: IsolatedAction | null =
    intent.kind === "all"
      ? { kind: "repayShares", shares: "all" }
      : intent.kind === "shares"
        ? { kind: "repayShares", shares: intent.shares }
        : sharesForInput !== undefined && sharesForInput > 0n
          ? { kind: "repayShares", shares: sharesForInput }
          : parsed > 0n
            ? { kind: "repay", amount: parsed }
            : null;
  const preview = action && sides ? isolatedPreview(read.state, action, sides) : null;
  const allowanceNote = (
    <AllowanceNote
      symbol={assetSymbol}
      decimals={assetDecimals}
      spenderLabel="pair"
      allowance={flow.allowance}
      approveAmount={plan && needsApproval ? plan.approve : undefined}
      expectedPull={plan?.assetValue}
      buffered
    />
  );

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess title={`Repaid ${submittedAll ? "all" : `~${amount}`} ${assetSymbol}`} hash={tx.hash} onClose={onClose}>
          {sides && <IsolatedAfterState read={read} sides={sides} receiptBlock={tx.receipt?.blockNumber} />}
          <PostTxAllowance refetch={flow.refetchAllowance} symbol={assetSymbol} decimals={assetDecimals} spenderLabel="pair" />
        </TxSuccess>
      ) : (
        <TxForm title={`Repay ${assetSymbol}`}>
          <p className="text-sm text-muted-foreground">Pay back {assetSymbol} to settle your debt in this isolated pair.</p>
          {positionState.status === "unknown" && (
            <p className="text-xs text-amber-400">Your position could not be read; repaying is disabled until it loads.</p>
          )}
          <AmountField
            label="Amount"
            aside={<>Debt: <span className="font-mono">{borrowedAmount === undefined ? "—" : formatToken(borrowedAmount, assetDecimals, assetSymbol, 6)}</span></>}
            value={intent.kind === "shares" ? "" : shownAmount}
            placeholder={intent.kind === "shares" ? `${intent.shares.toString()} shares` : "0.00"}
            decimals={assetDecimals}
            onChange={(v) => {
              setIntent({ kind: "amount" });
              setAmount(v);
            }}
            onMax={() => {
              setIntent({ kind: "all" });
              setAmount(borrowedAmount !== undefined ? formatUnits(borrowedAmount, assetDecimals) : "");
            }}
            maxDisabled={borrowedShares === 0n}
          >
            <p className="text-xs text-muted-foreground mt-1" data-testid="share-estimate">
              {intent.kind === "all"
                ? "Repay all: all your borrow shares; the pair takes their value at execution."
                : "Estimate: repays the shares this amount buys now; the pair takes their value at execution, which grows with accrual (covered by the 0.1% buffer)."}
            </p>
            {plan && (
              <p className="text-xs font-mono text-muted-foreground">
                {plan.shares.toString()} shares ≈ {formatToken(plan.assetValue, assetDecimals, assetSymbol, 6)} now
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
            {notice && <TxNotice testId="repay-notice">{notice}</TxNotice>}
            {!preview && (
              <div className="mt-1">
                <FreshnessStamp stamp={read.stamp} label="Position" />
              </div>
            )}
          </AmountField>

          {preview && sides && (
            <IsolatedRiskSummary
              preview={preview}
              sides={sides}
              apy={info?.borrowApr === undefined ? undefined : aprToApy(info.borrowApr)}
              apyLabel="Borrow APY"
              invalid={overShares ? "more than your debt" : walletShort ? "more than your wallet covers with the accrual margin" : null}
              stamp={read.stamp}
            />
          )}

          <TxSteps
            steps={flow.steps}
            approvalNeeded={needsApproval}
            approveAmount={plan && needsApproval ? plan.approve : undefined}
            symbol={assetSymbol}
            decimals={assetDecimals}
            actionLabel={`Repay ${assetSymbol}`}
            action={tx}
            ctx={CTX}
          />
          {needsApproval && allowanceNote}

          <TxButton
            onClick={handleRepay}
            isPending={tx.isPending || flow.isPending}
            isSimulating={tx.isSimulating || flow.isSimulating}
            isConfirming={tx.isConfirming || flow.isConfirming || flow.awaitingApproval}
            disabled={!address || positionState.status !== "known" || !plan || walletRaw === undefined || walletShort || overShares}
          >
            {needsApproval ? `Approve ${assetSymbol}` : `Repay ${assetSymbol}`}
          </TxButton>

          <TxDetails calls={plan ? [needsApproval ? flow.describeApprove(plan.approve) : null, previewCall(repayRequest(plan.shares))] : []}>
            {!needsApproval && allowanceNote}
          </TxDetails>
        </TxForm>
      )}
    </TxDialog>
  );
}
