"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { safeParseUnits, truncateAddress } from "@/lib/format";
import { exactApproval } from "@/lib/approvals";
import { abortFollowUp, cancelFollowUp } from "@/lib/approvalFlow";
import { formatHealth } from "@/lib/risk";
import { coreLiquidationEstimate } from "@/lib/txSummary";
import { HEALTH_FACTOR_LIQUIDATION_THRESHOLD } from "@/lib/liquidation";
import type { TxErrorContext } from "@/lib/txErrors";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { resultAt, useLuminaReader, useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow, type FollowUpResult } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { AmountField, TxDialog, TxForm, TxNotice, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { AfterState, LiquidationSummary } from "@/components/tx/TxSummary";
import { TxSteps } from "@/components/tx/TxSteps";
import { TxDetails } from "@/components/tx/TxDetails";
import { previewCall } from "@/components/tx/AfterStates";
import { afterReadStatus, useCatchUp, useCoreBorrowerRead } from "@/components/tx/reads";
import { UNAVAILABLE, formatAmount, formatToken } from "@/components/tx/format";

interface LiquidateModalProps {
  borrower: `0x${string}`;
  debtAsset: `0x${string}`;
  debtSymbol: string;
  debtDecimals: number;
  collateralAsset: `0x${string}`;
  collateralSymbol: string;
  collateralDecimals: number;
  /** The borrower's raw variable debt of `debtAsset` and aToken balance of `collateralAsset`. */
  borrowerDebt: bigint | undefined;
  borrowerCollateral: bigint | undefined;
  /** Largest debtToCover the pool will use (close factor by HF + collateral cap), base units. */
  maxDebt: bigint;
  /** Close factor applied, in bps (5000 or 10000). */
  closeFactorBps: bigint;
  collateralLimited: boolean;
  /**
   * The borrower is still in the page's live liquidatable list. The modal stays mounted by the
   * selected target when it drops out (a liquidation that heals the borrower keeps its success
   * screen); before sending, a healed borrower disables the action.
   */
  liquidatable: boolean;
  /**
   * The borrower is listed but its liquidation limit cannot be computed now (a price or reserve
   * config read failed): the stale limit is not used, the action is disabled.
   */
  limitUnavailable?: boolean;
  onClose: () => void;
}

type LiquidateParams = { amount: bigint };

const CTX: TxErrorContext = { venue: "core", action: "liquidate" };

export function LiquidateModal({
  borrower,
  debtAsset,
  debtSymbol,
  debtDecimals,
  collateralAsset,
  collateralSymbol,
  collateralDecimals,
  borrowerDebt,
  borrowerCollateral,
  maxDebt,
  closeFactorBps,
  collateralLimited,
  liquidatable,
  limitUnavailable = false,
  onClose,
}: LiquidateModalProps) {
  const [amount, setAmount] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const readNow = useLuminaReader();
  const actionable = liquidatable && !limitUnavailable;
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const wallet = useWalletBalance(debtAsset);
  const tx = useLuminaWrite();
  const { priceOf } = useOraclePrices();
  const { getMarket } = useAllMarkets();
  // The borrower re-read with a block stamp once the receipt is in (spec §3.2 profile (c)).
  const after = useCoreBorrowerRead(borrower, debtAsset, collateralAsset, tx.isSuccess);

  const parsedAmount = amount ? (safeParseUnits(amount, debtDecimals) ?? 0n) : 0n;
  const exceedsMax = parsedAmount > 0n && parsedAmount > maxDebt;
  const walletBalance = wallet.value;
  const insufficientBalance = walletBalance !== undefined && parsedAmount > walletBalance;

  // Aave V3: liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken)
  const liquidationRequest = (value: bigint) => ({
    address: pool ?? ("" as `0x${string}`),
    abi: POOL_ABI,
    functionName: "liquidationCall",
    args: [collateralAsset, debtAsset, borrower, value, false],
  });

  const stop = (text: string, reason: string) => {
    setNotice(text);
    return abortFollowUp(reason);
  };

  const sendLiquidation = async ({ amount: value }: LiquidateParams): Promise<FollowUpResult> => {
    if (!pool) return;
    setNotice(null);
    // The modal stays open by the selected target: a healed borrower must not be sent to (review
    // U2 r1 #3), neither from the page's list nor from the chain right before the wallet prompt.
    if (!actionable) {
      return stop("This borrower cannot be liquidated right now; nothing was sent.", "the borrower is no longer liquidatable");
    }
    const walletNow = await wallet.fetchNow();
    if (walletNow === undefined || walletNow < value) {
      toast.error("Liquidation not sent", { description: "Your wallet balance no longer covers the amount." });
      return abortFollowUp("your wallet balance no longer covers the amount");
    }
    let healthFactor: bigint | undefined;
    try {
      const account = resultAt<readonly unknown[]>(
        await readNow([{ address: pool, abi: POOL_ABI, functionName: "getUserAccountData", args: [borrower] }]),
        0,
      );
      healthFactor = account && typeof account[5] === "bigint" ? account[5] : undefined;
    } catch {
      healthFactor = undefined;
    }
    if (healthFactor === undefined || healthFactor >= HEALTH_FACTOR_LIQUIDATION_THRESHOLD) {
      return stop(
        healthFactor === undefined
          ? "The borrower's health factor could not be read; nothing was sent."
          : "The borrower's health factor is at or above 1.0 now; nothing was sent.",
        "the borrower is no longer liquidatable",
      );
    }
    // The account, chain and inputs must still be the ones this follow-up started with.
    const stale = flow.stale();
    if (stale) return cancelFollowUp(stale);
    await tx.send(liquidationRequest(value));
  };

  const flow = useApprovalFlow<LiquidateParams>({
    token: debtAsset,
    spender: pool,
    paramsKey: amount,
    onProceed: sendLiquidation,
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });
  const needsApproval = parsedAmount > 0n && flow.needsApproval(parsedAmount);

  useTxErrorToast(tx.error, "Liquidation failed", CTX);
  useTxErrorToast(flow.error, "Approval failed", { venue: "core", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Liquidation successful");

  const handleLiquidate = () => {
    if (!pool || parsedAmount === 0n) return;
    if (needsApproval) {
      // Exact, finite approval on purpose (review decision #4b): liquidationCall pulls at most
      // `debtToCover` (it lowers, never raises, the amount to the close-factor / collateral limit),
      // so accrual cannot make it pull more than approved. The repay buffer (R1-5 / R2-1) is for
      // repays, whose pulled amount can grow after the approval.
      void flow.start({ amount: parsedAmount }, exactApproval(parsedAmount));
      return;
    }
    void flow.proceed({ amount: parsedAmount });
  };

  const maxFormatted = formatUnits(maxDebt, debtDecimals);
  const bonus = getMarket(collateralAsset)?.config?.liquidationBonus;
  const estimate = coreLiquidationEstimate({
    amount: parsedAmount,
    maxDebtToCover: maxDebt,
    debt: borrowerDebt,
    collateral: borrowerCollateral,
    debtPrice: priceOf(debtAsset),
    collateralPrice: priceOf(collateralAsset),
    debtDecimals,
    collateralDecimals,
    liquidationBonus: bonus === undefined ? undefined : BigInt(bonus),
  });
  const afterStatus = afterReadStatus({
    receiptBlock: tx.receipt?.blockNumber,
    stamp: after.stamp,
    failed: after.failed,
    settled: after.settled,
  });
  useCatchUp(tx.isSuccess && afterStatus === "reading", after.refetch);

  const allowanceNote = (
    <AllowanceNote
      symbol={debtSymbol}
      decimals={debtDecimals}
      spenderLabel="Pool"
      allowance={flow.allowance}
      approveAmount={needsApproval ? parsedAmount : undefined}
    />
  );

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess
          title="Liquidation Successful"
          message={`Repaid ${debtSymbol} debt of ${truncateAddress(borrower)}; received ${collateralSymbol}.`}
          hash={tx.hash}
          onClose={onClose}
        >
          <AfterState
            title="Borrower after this liquidation"
            status={afterStatus}
            stamp={after.stamp}
            rows={[
              {
                label: "Borrower health factor",
                value: after.healthFactor === undefined ? UNAVAILABLE : formatHealth({ kind: "hf", healthFactor: after.healthFactor }).value,
              },
              { label: "Borrower debt", value: formatToken(after.debt, debtDecimals, debtSymbol) },
              { label: "Borrower collateral", value: formatToken(after.collateral, collateralDecimals, collateralSymbol) },
            ]}
          />
          <PostTxAllowance refetch={flow.refetchAllowance} symbol={debtSymbol} decimals={debtDecimals} spenderLabel="Pool" />
        </TxSuccess>
      ) : (
        <TxForm title="Liquidate Position">
          {limitUnavailable ? (
            <p className="text-sm text-muted-foreground">Max repayable: unavailable</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Max repayable: {formatAmount(maxDebt, debtDecimals, 6)} {debtSymbol} (
              {closeFactorBps === 10_000n ? "100% close factor, HF ≤ 0.95" : "50% close factor"}
              {collateralLimited ? ", limited by the collateral at the liquidation bonus" : ""})
            </p>
          )}
          {!liquidatable && (
            <TxNotice testId="not-liquidatable">This borrower is no longer liquidatable (health factor at or above 1.0).</TxNotice>
          )}
          {liquidatable && limitUnavailable && (
            <TxNotice testId="limit-unavailable">
              The liquidation limit is unavailable: a price or reserve config could not be read. Liquidating is disabled until it can.
            </TxNotice>
          )}
          <AmountField
            label="Repay Amount"
            aside={<>Wallet: <span className="font-mono">{walletBalance === undefined ? "—" : formatToken(walletBalance, debtDecimals, debtSymbol)}</span></>}
            value={amount}
            decimals={debtDecimals}
            onChange={setAmount}
            onMax={() => setAmount(maxFormatted)}
          >
            {exceedsMax && <p className="text-xs text-destructive mt-1">Amount exceeds the max liquidatable debt</p>}
            {insufficientBalance && !exceedsMax && <p className="text-xs text-destructive mt-1">Insufficient balance</p>}
            {notice && <TxNotice testId="liquidate-notice">{notice}</TxNotice>}
          </AmountField>

          {parsedAmount > 0n && (
            <LiquidationSummary
              figures={{
                repaid: estimate.repaid,
                debtBefore: borrowerDebt,
                debtAfter: estimate.debtAfter,
                collateralBefore: borrowerCollateral,
                collateralAfter: estimate.collateralAfter,
                debtSymbol,
                debtDecimals,
                collateralSymbol,
                collateralDecimals,
              }}
              note={
                exceedsMax
                  ? "The pool repays at most the max repayable amount; the estimate uses that."
                  : "Seizure at the oracle prices and the collateral's liquidation bonus."
              }
            />
          )}

          <TxSteps
            steps={flow.steps}
            approvalNeeded={needsApproval}
            approveAmount={needsApproval ? parsedAmount : undefined}
            symbol={debtSymbol}
            decimals={debtDecimals}
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
            disabled={!address || !actionable || parsedAmount === 0n || exceedsMax || walletBalance === undefined || insufficientBalance}
          >
            {needsApproval ? `Approve ${debtSymbol}` : "Execute Liquidation"}
          </TxButton>

          <TxDetails
            calls={parsedAmount > 0n ? [needsApproval ? flow.describeApprove(parsedAmount) : null, previewCall(liquidationRequest(parsedAmount))] : []}
          />
        </TxForm>
      )}
    </TxDialog>
  );
}
