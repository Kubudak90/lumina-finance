"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow, type FollowUpResult } from "@/hooks/useApprovalFlow";
import { useIsolatedFreshReads } from "@/hooks/useIsolatedFreshReads";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { hasExecutionHeadroom, repayApproval, repayHeadroom, vaultToAmount, vaultToShares, type VaultTotals } from "@/lib/approvals";
import { abortFollowUp, cancelFollowUp } from "@/lib/approvalFlow";
import {
  ISOLATED_LIQ_DEADLINE_SEC,
  ISOLATED_LIQ_GAS_PADDING,
  dirtyPartialWithinCleanBuffer,
  isolatedLiquidationMax,
  repaymentExceedsCollateral,
  simulateIsolatedLiquidation,
  type IsolatedLiquidationParams,
} from "@/lib/liquidation";
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
import { AfterState, IsolatedLiquidationSummary, SummaryRow } from "@/components/tx/TxSummary";
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

/** "max": recompute F5/F8 policy MAX on-chain at send time; otherwise exactly `shares`. */
type LiquidateParams = { useMax: boolean; shares: bigint };

const CTX: TxErrorContext = { venue: "isolated", action: "liquidate" };

/** `_deadline` argument: 120 seconds from now (F8; called when sending, never during render). */
function liquidationDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + ISOLATED_LIQ_DEADLINE_SEC);
}

/**
 * LightlendPair.liquidate(_sharesToLiquidate, _deadline, _borrower). Share-based: the pair pulls
 * the shares' value after accruing interest, so the approval carries the repay buffer —
 * ceil(currentShareValue × 1.001) + 1 — and the wallet must hold execution headroom
 * ceil(currentShareValue × 1.0005) + 1 (Codex #6, Gemini r2 M1).
 *
 * F8 amount policy (spec rev 3.3): MAX uses a zero profit floor and a 1% margin on the collateral
 * value, computed with the pair's exact integer arithmetic (`lib/liquidation.ts`), keeping repay-
 * buffer headroom below the clean threshold on dirty partials. Sending is blocked whenever the
 * quote-time repayment exceeds the collateral received or a dirty partial on an equity position
 * falls within the accrual buffer of the clean threshold (checked both at render and on fresh reads
 * right before sending). F2 gas rule: `gas = estimate + 1,000,000 + 100,000`.
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
  const [useMax, setUseMax] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();
  const fresh = useIsolatedFreshReads();
  const wallet = useWalletBalance(asset);
  const info = useIsolatedPair(pair);
  const tx = useLuminaWrite();
  // The borrower re-read (stamped) once the receipt is in (spec §3.2 profile (c)).
  const after = useIsolatedAccountRead(pair, dualOracle ?? info?.dualOracle, borrower, tx.isSuccess);

  const totalBorrow: VaultTotals | undefined =
    info?.totalBorrowAmount !== undefined && info?.totalBorrowShares !== undefined
      ? { amount: info.totalBorrowAmount, shares: info.totalBorrowShares }
      : undefined;
  const liqRate = info?.lowExchangeRate ?? info?.exchangeRate;
  const cleanFee = info?.cleanLiquidationFee;
  const dirtyFee = info?.dirtyLiquidationFee;
  const protocolFee = info?.protocolLiquidationFee;
  const liqParams: IsolatedLiquidationParams | null =
    totalBorrow !== undefined &&
    liqRate !== undefined &&
    liqRate > 0n &&
    cleanFee !== undefined &&
    dirtyFee !== undefined &&
    protocolFee !== undefined
      ? {
          borrowerShares: borrowerDebtShares,
          collateral: borrowerCollateral,
          totalBorrow,
          exchangeRate: liqRate,
          cleanLiquidationFee: cleanFee,
          dirtyLiquidationFee: dirtyFee,
          protocolLiquidationFee: protocolFee,
        }
      : null;
  const maxPlan = liqParams ? isolatedLiquidationMax(liqParams) : null;

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const shownAmount = useMax && maxPlan?.outcome ? formatUnits(maxPlan.outcome.repayment, assetDecimals) : amount;

  const sharesPreview = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "toBorrowShares",
    args: [parsed, false, true],
    query: { enabled: parsed > 0n && !useMax, ...QUERY.user },
  });
  const computedShares =
    (sharesPreview.data as bigint | undefined) ??
    (totalBorrow !== undefined && parsed > 0n ? vaultToShares(totalBorrow, parsed, false) : undefined);
  const sharesToLiquidate = useMax ? (maxPlan?.shares ?? 0n) : (computedShares ?? 0n);
  const overShares = !useMax && sharesToLiquidate > borrowerDebtShares;

  const estimate = isolatedLiquidationEstimate({
    shares: sharesToLiquidate,
    borrowerShares: borrowerDebtShares,
    totalBorrow,
    debt: borrowerDebtAsset,
    collateral: borrowerCollateral,
    exchangeRate: liqRate,
    cleanLiquidationFee: cleanFee,
    dirtyLiquidationFee: dirtyFee,
    protocolLiquidationFee: protocolFee,
  });

  const shareValue = estimate.repaid;
  const approveAmount = shareValue !== undefined && shareValue > 0n ? repayApproval(shareValue) : undefined;
  const walletRaw = wallet.value;
  // The pull is the shares' current value (it grows with accrual), not the typed amount.
  const insufficientWallet = shareValue !== undefined && walletRaw !== undefined && walletRaw < repayHeadroom(shareValue);
  const repaymentBlocked = estimate.repaymentExceedsCollateral;
  const cleanBufferBlocked = liqParams !== null && dirtyPartialWithinCleanBuffer(liqParams, sharesToLiquidate);
  const sendBlocked = repaymentBlocked || cleanBufferBlocked;
  const paramsUnavailable = liqParams === null;

  const liquidateRequest = (shares: bigint, deadline: bigint | string) => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "liquidate",
    args: [shares, deadline, borrower],
    gasPadding: ISOLATED_LIQ_GAS_PADDING,
  });

  const stop = (text: string, reason: string, reapprove = false) => {
    setNotice(text);
    return abortFollowUp(reason, reapprove);
  };

  const sendLiquidation = async (params: LiquidateParams): Promise<FollowUpResult> => {
    if (!address) return;
    setNotice(null);
    // The modal stays open by the selected target: never send to a borrower the page no longer
    // lists, nor to one the pair sees as solvent right now (review U2 r1 #3).
    if (!liquidatable) return stop("The borrower has no debt left in this pair; nothing was sent.", "the borrower is no longer liquidatable");
    try {
      // Atomic single-block read from the chain: borrower state, allowance, wallet, rate, totals and fees.
      const ctx = await fresh.liquidationContext(pair, borrower, asset, address, dualOracle ?? info?.dualOracle ?? null);
      if (ctx.borrowShares === 0n) {
        return stop("The borrower has no debt left; nothing was sent.", "the borrower has no debt left");
      }
      const freshParams: IsolatedLiquidationParams = {
        borrowerShares: ctx.borrowShares,
        collateral: ctx.collateral,
        totalBorrow: ctx.totalBorrow,
        exchangeRate: ctx.lowExchangeRate,
        cleanLiquidationFee: ctx.cleanLiquidationFee,
        dirtyLiquidationFee: ctx.dirtyLiquidationFee,
        protocolLiquidationFee: ctx.protocolLiquidationFee,
      };
      // Solvency as `liquidate` checks it: `_isSolvent(_borrower, _lowExchangeRate)`.
      const debtNow = vaultToAmount(ctx.totalBorrow, ctx.borrowShares, true);
      const ltvNow = isolatedLtvOf({ debt: debtNow, collateral: ctx.collateral, maxLTV: ctx.maxLtv, exchangeRate: ctx.lowExchangeRate });
      const insolvent = ltvNow.kind === "infinite" || (ltvNow.kind === "value" && ltvNow.ltv > ctx.maxLtv);
      if (!insolvent) {
        return stop(
          ltvNow.kind === "unavailable"
            ? "The borrower's solvency could not be read; nothing was sent."
            : "The borrower is solvent at the pair's current price; nothing was sent.",
          "the borrower is no longer liquidatable",
        );
      }

      let shares: bigint;
      if (params.useMax) {
        const freshMax = isolatedLiquidationMax(freshParams);
        if (freshMax.shares === 0n) {
          return stop(
            freshMax.hasEquity
              ? "Full repayment earns less than the 1% safety margin, and a larger partial would leave the borrower's remaining debt uncovered at the pair's current rate; nothing was sent."
              : "No share amount fits within the 1% collateral margin at the pair's current rate; nothing was sent.",
            freshMax.hasEquity
              ? "no dirty partial leaves the borrower's remaining debt covered within the safety margin"
              : "no share amount fits within the collateral margin",
          );
        }
        shares = freshMax.shares;
      } else {
        shares = params.shares;
        if (shares === 0n) {
          return stop("No shares selected; nothing was sent.", "no shares selected");
        }
        if (shares > ctx.borrowShares) {
          return stop(
            `The borrower now owes ${ctx.borrowShares.toString()} shares, fewer than the ${shares.toString()} selected; nothing was sent.`,
            "the borrower's debt is now smaller than the selected shares",
          );
        }
      }

      const freshSim = simulateIsolatedLiquidation(freshParams, shares);
      if (repaymentExceedsCollateral(freshSim, freshParams.exchangeRate)) {
        return stop(
          "Repayment exceeds the collateral you would receive at the pair's current rate; nothing was sent.",
          "repayment exceeds the collateral received",
        );
      }
      if (dirtyPartialWithinCleanBuffer(freshParams, shares)) {
        return stop(
          "This partial liquidation is too close to the clean threshold at the pair's current state: interest accruing before inclusion could flip it to a clean liquidation and write off unpaid debt; nothing was sent.",
          "dirty partial is within the accrual buffer of the clean threshold",
        );
      }

      const valueNow = freshSim.repayment;
      if (!hasExecutionHeadroom({ allowance: ctx.allowance, wallet: ctx.wallet, value: valueNow })) {
        const walletShortNow = ctx.wallet < repayHeadroom(valueNow);
        return stop(
          walletShortNow
            ? `Your wallet no longer covers these shares (${formatAmount(valueNow, assetDecimals)} ${assetSymbol}) plus the accrual margin; nothing was sent.`
            : "The shares' value grew past the approved amount; approve again.",
          walletShortNow ? "the wallet no longer covers the shares' value" : "interest pushed the value past the approved headroom",
          !walletShortNow,
        );
      }
      // The account, chain and inputs must still be the ones this follow-up started with.
      const stale = flow.stale();
      if (stale) return cancelFollowUp(stale);
      await tx.send(liquidateRequest(shares, liquidationDeadline()));
    } catch (err) {
      return stop(`Re-check failed (${(err as Error).message}); nothing was sent.`, "the re-check could not read the chain");
    }
  };

  const flow = useApprovalFlow<LiquidateParams>({
    token: asset,
    spender: pair,
    paramsKey: `${borrower}|${useMax ? "max" : amount}`,
    onProceed: sendLiquidation,
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });
  const approvalNeeded = approveAmount !== undefined && flow.needsApproval(approveAmount);

  useTxErrorToast(tx.error, "Liquidate failed", CTX);
  useTxErrorToast(flow.error, "Approval failed", { venue: "isolated", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Liquidation successful", `Received ${collateralSymbol} collateral`);

  const handleLiquidate = () => {
    if (!address || paramsUnavailable || sharesToLiquidate === 0n || sendBlocked || approveAmount === undefined) return;
    const params: LiquidateParams = { useMax, shares: sharesToLiquidate };
    if (approvalNeeded) {
      void flow.start(params, approveAmount);
      return;
    }
    void flow.proceed(params);
  };

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

  const summaryNote = estimate.isClean
    ? estimate.writeOff !== undefined && estimate.writeOff > 0n
      ? "Clean path (at quote time): takes all of the borrower's collateral; only unpaid shares are written off. A price move before inclusion can change the outcome."
      : "Clean path (at quote time): takes all of the borrower's collateral with no debt written off. A price move before inclusion can change the outcome."
    : "Dirty path (at quote time): leaves collateral with the borrower and writes off no debt. A price move before inclusion can change the outcome.";

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
            <SummaryRow label="Debt" before={formatToken(borrowerDebtAsset, assetDecimals, assetSymbol)} />
            <SummaryRow label="Collateral" before={formatToken(borrowerCollateral, collateralDecimals, collateralSymbol)} />
          </div>
          <p className="text-sm text-muted-foreground">
            Pay {assetSymbol} to repay part or all of the borrower&apos;s debt and receive {collateralSymbol}. The pair
            reverts if the borrower is solvent at execution time. Repayment vs. collateral comparison holds at quote time
            only; the pair has no minimum-collateral bound (deadline: {ISOLATED_LIQ_DEADLINE_SEC} s).
          </p>
          {!liquidatable && <TxNotice testId="not-liquidatable">The borrower has no debt left in this pair.</TxNotice>}
          {paramsUnavailable && (
            <TxNotice testId="liquidation-params-unavailable">
              Pair rate, totals or liquidation fees could not be read; liquidating is disabled until they load.
            </TxNotice>
          )}
          <AmountField
            label={`Amount to Repay (${assetSymbol})`}
            aside={<>Wallet: <span className="font-mono">{walletRaw === undefined ? "—" : formatAmount(walletRaw, assetDecimals)}</span></>}
            value={shownAmount}
            decimals={assetDecimals}
            onChange={(v) => {
              setUseMax(false);
              setAmount(v);
            }}
            onMax={() => setUseMax(true)}
            maxDisabled={maxPlan === null || maxPlan.shares === 0n}
          >
            {maxPlan !== null && maxPlan.shares === 0n && borrowerDebtShares > 0n && (
              <p className="text-xs text-warning-strong mt-1" data-testid="no-safe-max">
                {maxPlan.hasEquity
                  ? "MAX is 0: full repayment earns less than the 1% safety margin, and a larger partial would leave the borrower's remaining debt uncovered at the quote-time rate. You can still type an amount."
                  : "No share amount fits within the 1% collateral margin at the quote-time rate."}
              </p>
            )}
            {maxPlan !== null && maxPlan.hasEquity && maxPlan.mode === "dirty" && maxPlan.outcome !== null && (
              <p className="text-xs text-muted-foreground mt-1" data-testid="dirty-max-reason">
                MAX is limited to {formatToken(maxPlan.outcome.repayment, assetDecimals, assetSymbol)}: full repayment earns less than the 1%
                safety margin, and a larger partial would leave the borrower&apos;s remaining debt uncovered at the quote-time rate. You can
                still type an amount.
              </p>
            )}
            {shareValue !== undefined && (
              <p className="text-xs text-muted-foreground mt-1">
                Quote: {sharesToLiquidate.toString()} shares, currently {formatToken(shareValue, assetDecimals, assetSymbol)}; the pair takes
                their value at execution.
              </p>
            )}
            {overShares && (
              <p className="text-xs text-destructive mt-1" data-testid="share-bound-error">
                More than the borrower&apos;s debt ({borrowerDebtShares.toString()} shares); use MAX.
              </p>
            )}
            {insufficientWallet && <p className="text-xs text-destructive mt-1">Insufficient {assetSymbol} for the current share value plus the accrual margin</p>}
            {notice && <TxNotice testId="liquidate-notice">{notice}</TxNotice>}
          </AmountField>

          {sharesToLiquidate > 0n && (
            <IsolatedLiquidationSummary
              figures={{
                repaid: estimate.repaid,
                collateralSeized: estimate.collateralSeized,
                protocolFee: estimate.protocolFee,
                collateralReceived: estimate.collateralReceived,
                writeOff: estimate.writeOff,
                debtBefore: borrowerDebtAsset,
                debtAfter: estimate.debtAfter,
                collateralBefore: borrowerCollateral,
                collateralAfter: estimate.collateralAfter,
                debtSymbol: assetSymbol,
                debtDecimals: assetDecimals,
                collateralSymbol,
                collateralDecimals,
              }}
              blocked={
                repaymentBlocked
                  ? "Repayment exceeds the collateral you would receive at the quote-time rate; sending is blocked."
                  : null
              }
              cleanBufferBlocked={
                cleanBufferBlocked
                  ? "This partial amount is too close to the clean threshold: interest accruing before inclusion could flip it to a clean liquidation and write off unpaid debt on a position with equity. Lower the amount or repay in full; sending is blocked."
                  : null
              }
              note={summaryNote}
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
          {allowanceNote}

          <TxButton
            onClick={handleLiquidate}
            isPending={tx.isPending || flow.isPending}
            isSimulating={tx.isSimulating || flow.isSimulating}
            isConfirming={tx.isConfirming || flow.isConfirming || flow.awaitingApproval}
            isChecking={flow.isChecking}
            disabled={
              !address ||
              !liquidatable ||
              paramsUnavailable ||
              sharesToLiquidate === 0n ||
              overShares ||
              sendBlocked ||
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
                    previewCall(liquidateRequest(sharesToLiquidate, `now + ${ISOLATED_LIQ_DEADLINE_SEC} s, set when sending`)),
                  ]
                : []
            }
          />
        </TxForm>
      )}
    </TxDialog>
  );
}
