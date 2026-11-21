"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useIsolatedFreshReads } from "@/hooks/useIsolatedFreshReads";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { hasExecutionHeadroom, repayApproval, repayHeadroom } from "@/lib/approvals";
import { abortFollowUp, type FollowUpAbort } from "@/lib/approvalFlow";
import { formatHealth, isolatedLtvOf } from "@/lib/risk";
import { isolatedLiquidationEstimate } from "@/lib/txSummary";
import type { TxErrorContext } from "@/lib/txErrors";
import { QUERY } from "@/lib/queryPolicy";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { safeParseUnits, truncateAddress } from "@/lib/format";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { AmountField, TxDialog, TxForm, TxNotice, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { AfterState, LiquidationSummary, SummaryRow } from "@/components/tx/TxSummary";
import { TxSteps } from "@/components/tx/TxSteps";
import { TxDetails } from "@/components/tx/TxDetails";
import { previewCall } from "@/components/tx/AfterStates";
import { afterReadStatus, useCatchUp, useIsolatedAccountRead } from "@/components/tx/reads";
import { UNAVAILABLE, formatAmount, formatToken } from "@/components/tx/format";

interface Props {
  pair: `0x${string}`;
  asset: `0x${string}`;
  assetSymbol: string;
  assetDecimals: number;
  collateralSymbol: string;
  collateralDecimals: number;
  borrower: `0x${string}`;
  /** Live (polled) borrower data from the page (the last one seen once the borrower drops out). */
  borrowerDebtAsset: bigint | undefined;
  borrowerDebtShares: bigint;
  borrowerCollateral: bigint;
  /** Pair dual oracle (for the post-receipt borrower read); defaults to the pair's. */
  dualOracle?: `0x${string}` | null;
  /**
   * The borrower still has debt in the page's live list (default true). The modal stays mounted by
   * the selected target when it drops out, so a full liquidation keeps its success screen.
   */
  liquidatable?: boolean;
  onClose: () => void;
}

/** "all": every borrow share of the borrower at send time; otherwise exactly `shares`. */
type LiquidateParams = { all: boolean; shares: bigint };

const CTX: TxErrorContext = { venue: "isolated", action: "liquidate" };

/** `_deadline` argument: 30 minutes from now (called when sending, never during render). */
function liquidationDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
}

/**
 * LightlendPair.liquidate(_sharesToLiquidate, _deadline, _borrower). Like a repay this is
 * share-based: the pair pulls the shares' value after accruing interest, so the approval carries
 * the repay buffer — ceil(currentShareValue × 1.001) + 1 — and the wallet must hold the execution
 * headroom ceil(currentShareValue × 1.0005) + 1, not just the typed amount (Codex #6, Gemini r2 M1).
 * Shares above the borrower's debt shares are refused (M2), and right before sending the borrower's
 * shares, the share value, the allowance and the wallet are read from the chain (M3).
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
  dualOracle,
  liquidatable = true,
  onClose,
}: Props) {
  const [amount, setAmount] = useState("");
  const [all, setAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();
  const fresh = useIsolatedFreshReads();
  const wallet = useWalletBalance(asset);
  const info = useIsolatedPair(pair);
  const tx = useLuminaWrite();
  // The borrower re-read (stamped) once the receipt is in (spec §3.2 profile (c)).
  const after = useIsolatedAccountRead(pair, dualOracle ?? info?.dualOracle, borrower, tx.isSuccess);

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
  const overShares = !all && sharesToLiquidate > borrowerDebtShares;

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
  const insufficientWallet = shareValue !== undefined && walletRaw !== undefined && walletRaw < repayHeadroom(shareValue);

  const liquidateRequest = (shares: bigint, deadline: bigint | string) => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "liquidate",
    args: [shares, deadline, borrower],
  });

  const stop = (text: string, reason: string, reapprove = false) => {
    setNotice(text);
    return abortFollowUp(reason, reapprove);
  };

  const sendLiquidation = async (params: LiquidateParams): Promise<FollowUpAbort | void> => {
    if (!address) return;
    setNotice(null);
    try {
      // From the chain, not the poll cache: the borrower's shares, then their current value.
      const state = await fresh.accountState(pair, borrower, asset, address);
      const shares = params.all ? state.borrowShares : params.shares;
      if (shares === 0n || state.borrowShares === 0n) {
        return stop("The borrower has no debt left; nothing was sent.", "the borrower has no debt left");
      }
      if (shares > state.borrowShares) {
        return stop(
          `The borrower now owes ${state.borrowShares.toString()} shares, fewer than the ${shares.toString()} selected; nothing was sent.`,
          "the borrower's debt is now smaller than the selected shares",
        );
      }
      const valueNow = await fresh.shareValue(pair, shares);
      if (!hasExecutionHeadroom({ allowance: state.allowance, wallet: state.wallet, value: valueNow })) {
        const walletShortNow = state.wallet < repayHeadroom(valueNow);
        return stop(
          walletShortNow
            ? `Your wallet no longer covers these shares (${formatAmount(valueNow, assetDecimals, 6)} ${assetSymbol}) plus the accrual margin; nothing was sent.`
            : "The shares' value grew past the approved amount; approve again.",
          walletShortNow ? "the wallet no longer covers the shares' value" : "interest pushed the value past the approved headroom",
          !walletShortNow,
        );
      }
      await tx.send(liquidateRequest(shares, liquidationDeadline()));
    } catch (err) {
      return stop(`Re-check failed (${(err as Error).message}); nothing was sent.`, "the re-check could not read the chain");
    }
  };

  const flow = useApprovalFlow<LiquidateParams>({
    token: asset,
    spender: pair,
    paramsKey: `${borrower}|${all ? "all" : amount}`,
    onProceed: sendLiquidation,
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });
  const approvalNeeded = approveAmount !== undefined && flow.needsApproval(approveAmount);

  useTxErrorToast(tx.error, "Liquidate failed", CTX);
  useTxErrorToast(flow.error, "Approval failed", { venue: "isolated", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Liquidation successful", `Received ${collateralSymbol} collateral`);

  const handleLiquidate = () => {
    if (!address || sharesToLiquidate === 0n || approveAmount === undefined) return;
    const params: LiquidateParams = { all, shares: sharesToLiquidate };
    if (approvalNeeded) {
      void flow.start(params, approveAmount);
      return;
    }
    void flow.proceed(params);
  };

  const estimate = isolatedLiquidationEstimate({
    shareValue,
    debt: borrowerDebtAsset,
    collateral: borrowerCollateral,
    exchangeRate: info?.exchangeRate,
  });
  const afterStatus = afterReadStatus({
    receiptBlock: tx.receipt?.blockNumber,
    stamp: after.stamp,
    failed: after.failed,
    settled: after.settled,
  });
  useCatchUp(tx.isSuccess && afterStatus === "reading", after.refetch);
  const afterLtv = isolatedLtvOf(after.state);

  const allowanceNote = (
    <AllowanceNote
      symbol={assetSymbol}
      decimals={assetDecimals}
      spenderLabel="pair"
      allowance={flow.allowance}
      approveAmount={approvalNeeded ? approveAmount : undefined}
      expectedPull={shareValue}
      buffered
    />
  );

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess
          title="Liquidation Successful"
          message={<>Repaid part of {truncateAddress(borrower)}&apos;s debt; received {collateralSymbol}.</>}
          hash={tx.hash}
          onClose={onClose}
        >
          <AfterState
            title="Borrower after this liquidation"
            status={afterStatus}
            stamp={after.stamp}
            rows={[
              {
                label: "Borrower LTV",
                value: afterLtv.kind === "unavailable" ? UNAVAILABLE : formatHealth({ kind: "ltv", ltv: afterLtv, maxLTV: after.state.maxLTV }).value,
              },
              { label: "Borrower debt", value: formatToken(after.state.debt, assetDecimals, assetSymbol) },
              { label: "Borrower collateral", value: formatToken(after.state.collateral, collateralDecimals, collateralSymbol) },
            ]}
          />
          <PostTxAllowance refetch={flow.refetchAllowance} symbol={assetSymbol} decimals={assetDecimals} spenderLabel="pair" />
        </TxSuccess>
      ) : (
        <TxForm title="Liquidate Position">
          <div className="technical-border bg-background p-3 space-y-1 text-sm">
            <SummaryRow label="Borrower" before={truncateAddress(borrower)} />
            <SummaryRow label="Debt" before={formatToken(borrowerDebtAsset, assetDecimals, assetSymbol, 6)} />
            <SummaryRow label="Collateral" before={formatToken(borrowerCollateral, collateralDecimals, collateralSymbol)} />
          </div>
          <p className="text-sm text-muted-foreground">
            Pay {assetSymbol} to settle part or all of the borrower&apos;s debt and receive {collateralSymbol} (with discount). The pair
            reverts if the borrower is solvent at execution time.
          </p>
          {!liquidatable && <TxNotice testId="not-liquidatable">The borrower has no debt left in this pair.</TxNotice>}
          <AmountField
            label={`Amount to Repay (${assetSymbol})`}
            aside={<>Wallet: <span className="font-mono">{walletRaw === undefined ? "—" : formatAmount(walletRaw, assetDecimals)}</span></>}
            value={shownAmount}
            decimals={assetDecimals}
            onChange={(v) => {
              setAll(false);
              setAmount(v);
            }}
            onMax={() => setAll(true)}
            maxDisabled={borrowerDebtShares === 0n}
          >
            {shareValue !== undefined && (
              <p className="text-xs text-muted-foreground mt-1">
                Estimate: {sharesToLiquidate.toString()} shares, currently {formatToken(shareValue, assetDecimals, assetSymbol, 6)}; the pair takes
                their value at execution.
              </p>
            )}
            {overShares && (
              <p className="text-xs text-destructive mt-1" data-testid="share-bound-error">
                More than the borrower&apos;s debt ({borrowerDebtShares.toString()} shares); use MAX.
              </p>
            )}
            {insufficientWallet && <p className="text-xs text-destructive mt-1">Insufficient {assetSymbol} for the current share value plus the accrual margin</p>}
            {notice && <TxNotice>{notice}</TxNotice>}
          </AmountField>

          {sharesToLiquidate > 0n && (
            <LiquidationSummary
              figures={{
                repaid: estimate.repaid,
                debtBefore: borrowerDebtAsset,
                debtAfter: estimate.debtAfter,
                collateralBefore: borrowerCollateral,
                collateralAfter: estimate.collateralAfter,
                debtSymbol: assetSymbol,
                debtDecimals: assetDecimals,
                collateralSymbol,
                collateralDecimals,
              }}
              note={
                estimate.collateralExhausted
                  ? "This takes all of the borrower's collateral; the pair writes off any debt left over."
                  : "Remaining collateral is at most this: the pair also takes its liquidation fee, which is not read here."
              }
            />
          )}

          <TxSteps
            steps={flow.steps}
            approvalNeeded={approvalNeeded}
            approveAmount={approvalNeeded ? approveAmount : undefined}
            symbol={assetSymbol}
            decimals={assetDecimals}
            actionLabel="Liquidation"
            action={tx}
            ctx={CTX}
          />
          {approvalNeeded && allowanceNote}

          <TxButton
            onClick={handleLiquidate}
            isPending={tx.isPending || flow.isPending}
            isSimulating={tx.isSimulating || flow.isSimulating}
            isConfirming={tx.isConfirming || flow.isConfirming || flow.awaitingApproval}
            disabled={
              !address ||
              !liquidatable ||
              sharesToLiquidate === 0n ||
              overShares ||
              walletRaw === undefined ||
              insufficientWallet ||
              borrowerDebtShares === 0n ||
              approveAmount === undefined
            }
          >
            {approvalNeeded ? `Approve ${assetSymbol}` : "Liquidate"}
          </TxButton>

          <TxDetails
            calls={
              sharesToLiquidate > 0n
                ? [
                    approvalNeeded && approveAmount !== undefined ? flow.describeApprove(approveAmount) : null,
                    previewCall(liquidateRequest(sharesToLiquidate, "now + 30 min, set when sending")),
                  ]
                : []
            }
          >
            {!approvalNeeded && allowanceNote}
          </TxDetails>
        </TxForm>
      )}
    </TxDialog>
  );
}
