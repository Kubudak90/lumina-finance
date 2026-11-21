"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { safeParseUnits } from "@/lib/format";
import { coreFullRepayFunding, hasExecutionHeadroom, planCoreRepay } from "@/lib/approvals";
import { abortFollowUp, cancelFollowUp } from "@/lib/approvalFlow";
import { coreApy, corePreview } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { QUERY } from "@/lib/queryPolicy";
import { POOL_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";
import { LUMINA, getCoreMarketByAsset } from "@/lib/deployments";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow, type FollowUpResult } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { AmountField, TxDialog, TxForm, TxNotice, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { CoreRiskSummary, SummaryRow } from "@/components/tx/TxSummary";
import { TxSteps } from "@/components/tx/TxSteps";
import { TxDetails } from "@/components/tx/TxDetails";
import { CoreAfterState, previewCall } from "@/components/tx/AfterStates";
import { useCoreRiskInputs } from "@/components/tx/reads";
import { formatAmount, formatToken } from "@/components/tx/format";

interface RepayModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

type RepayParams = { repayAll: boolean; input: bigint };

const CTX: TxErrorContext = { venue: "core", action: "repay" };

/**
 * Core (Aave) repay.
 * - MAX sets a "repay all" intent, kept apart from the amount text until the user edits it: the
 *   repay then sends Aave's entire-debt sentinel and approves the buffered CURRENT debt (#5).
 * - Every repay's allowance threshold is the buffered amount (R1-5, Codex #4a).
 * - The wallet must hold the execution headroom over the current debt (ceil(debt × 1.0005) + 1)
 *   for a full repay; otherwise a partial repay of the wallet balance is offered (#6). After the
 *   approval confirms, wallet and allowance are re-read and need only that headroom over the
 *   accrued debt, never a fresh 10 bps buffer (Gemini r2 C1).
 */
export function RepayModal({ asset, symbol, decimals, onClose }: RepayModalProps) {
  const [amount, setAmount] = useState("");
  const [repayAll, setRepayAll] = useState(false);
  const [submittedFull, setSubmittedFull] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const debtToken = getCoreMarketByAsset(asset)?.variableDebtToken ?? undefined;
  const tx = useLuminaWrite();
  const wallet = useWalletBalance(asset);
  const core = useCoreRiskInputs();

  // The debt the pool will see, polled; re-read right before sending.
  const debtRead = useLuminaReadContract({
    address: debtToken,
    abi: VARIABLE_DEBT_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!debtToken, ...QUERY.user },
  });
  const debt = debtRead.data as bigint | undefined;
  const walletValue = wallet.value;

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;
  const shownAmount = repayAll && debt !== undefined ? formatUnits(debt, decimals) : amount;

  const planFor = (params: RepayParams, debtNow: bigint) =>
    (params.repayAll ? debtNow > 0n : params.input > 0n) ? planCoreRepay({ ...params, debt: debtNow }) : null;
  const plan = debt !== undefined ? planFor({ repayAll, input: parsedAmount }, debt) : null;
  const funding = plan?.full && walletValue !== undefined && debt !== undefined ? coreFullRepayFunding(walletValue, debt) : null;
  const shortForPartial = !repayAll && walletValue !== undefined && parsedAmount > walletValue;

  const repayRequest = (amountArg: bigint) => ({
    address: pool ?? ("" as `0x${string}`),
    abi: POOL_ABI,
    functionName: "repay",
    args: [asset, amountArg, 2n, address],
  });

  /** Stop before sending: the long text for the notice, the short one for row 2 of TxSteps. */
  const stop = (text: string, reason: string, reapprove = false) => {
    setNotice(text);
    return abortFollowUp(reason, reapprove);
  };

  const sendRepay = async (params: RepayParams): Promise<FollowUpResult> => {
    if (!address || !pool) return;
    setNotice(null);
    // Re-validate against the chain right before the wallet prompt (#6).
    const [debtNow, walletNow, allowanceNow] = await Promise.all([
      debtRead.refetch().then((r) => r.data as bigint | undefined),
      wallet.fetchNow(),
      flow.refetchAllowance(),
    ]);
    if (debtNow === undefined || walletNow === undefined || allowanceNow === undefined) {
      return stop("Could not re-read your debt, wallet or allowance; nothing was sent.", "the re-check could not read the chain");
    }
    const next = planFor(params, debtNow);
    if (!next) return stop("Nothing left to repay.", "nothing left to repay");
    if (next.full) {
      // The pool pulls the debt at execution: wallet and allowance need only the execution headroom
      // over the CURRENT debt (half the approval buffer), not a fresh buffer (Gemini r2 C1).
      const f = coreFullRepayFunding(walletNow, debtNow);
      if (!f.fundable) {
        return stop(
          `Your wallet (${formatAmount(walletNow, decimals)} ${symbol}) does not cover the full debt plus the accrual margin. Repay ${formatAmount(f.partial, decimals)} ${symbol} instead.`,
          "the wallet no longer covers the full debt",
        );
      }
      if (!hasExecutionHeadroom({ allowance: allowanceNow, wallet: walletNow, value: debtNow })) {
        return stop("The debt grew past the approved amount; approve again.", "interest pushed the debt past the approved headroom", true);
      }
    } else {
      // A finite repay pulls exactly the amount (at most the debt): no accrual margin needed.
      if (walletNow < next.amountArg) {
        return stop("Your wallet balance no longer covers the amount; nothing was sent.", "the wallet no longer covers the amount");
      }
      if (allowanceNow < next.amountArg) {
        return stop("The allowance no longer covers the amount; approve again.", "the allowance no longer covers the amount", true);
      }
    }
    // The account, chain and inputs must still be the ones this follow-up started with.
    const stale = flow.stale();
    if (stale) return cancelFollowUp(stale);
    setSubmittedFull(next.full);
    await tx.send(repayRequest(next.amountArg));
  };

  const flow = useApprovalFlow<RepayParams>({
    token: asset,
    spender: pool,
    paramsKey: repayAll ? "all" : amount,
    onProceed: sendRepay,
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });
  const needsApproval = plan !== null && flow.needsApproval(plan.approve);

  useTxErrorToast(tx.error, "Repayment failed", CTX);
  useTxErrorToast(flow.error, "Approval failed", { venue: "core", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Repayment successful");

  const handleRepay = () => {
    if (!address || !pool || !plan) return;
    const params = { repayAll, input: parsedAmount };
    if (needsApproval) {
      void flow.start(params, plan.approve);
      return;
    }
    void flow.proceed(params);
  };

  const offerPartial = (partial: bigint) => {
    setRepayAll(false);
    setAmount(formatUnits(partial, decimals));
    setNotice(null);
  };

  const preview = plan ? corePreview(core.snapshot, { kind: "repay", asset, amount: plan.full ? "all" : parsedAmount }) : null;
  const allowanceNote = (
    <AllowanceNote
      symbol={symbol}
      decimals={decimals}
      spenderLabel="Pool"
      allowance={flow.allowance}
      approveAmount={plan && needsApproval ? plan.approve : undefined}
      expectedPull={plan?.assetValue}
      buffered
    />
  );

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess
          title="Repayment Successful"
          message={`You repaid ${submittedFull ? "your full" : amount} ${symbol}${submittedFull ? " debt" : ""}`}
          hash={tx.hash}
          onClose={onClose}
        >
          <CoreAfterState core={core} receiptBlock={tx.receipt?.blockNumber} />
          <PostTxAllowance refetch={flow.refetchAllowance} symbol={symbol} decimals={decimals} spenderLabel="Pool" />
        </TxSuccess>
      ) : (
        <TxForm title={`Repay ${symbol}`}>
          <div className="technical-border bg-background p-3 space-y-1">
            <SummaryRow label={`${symbol} Debt`} before={debt === undefined ? "—" : formatToken(debt, decimals, symbol)} />
            <SummaryRow label="Wallet" before={walletValue === undefined ? "—" : formatToken(walletValue, decimals, symbol)} />
          </div>

          <AmountField
            label="Amount"
            aside={repayAll ? <span className="text-xs text-accent font-mono">Full debt (updates with accrual)</span> : undefined}
            value={shownAmount}
            decimals={decimals}
            onChange={(v) => {
              setRepayAll(false);
              setAmount(v);
            }}
            onMax={() => {
              setRepayAll(true);
              setAmount(debt !== undefined ? formatUnits(debt, decimals) : "");
            }}
            maxDisabled={debt === undefined || debt === 0n}
          >
            {shortForPartial && <p className="text-xs text-destructive mt-1">Insufficient wallet balance</p>}
            {funding && !funding.fundable && (
              <div className="text-xs text-amber-400 mt-1 space-y-1" data-testid="partial-offer">
                <p>Your wallet does not cover the full debt plus the accrual margin (0.05%).</p>
                <button type="button" className="underline" onClick={() => offerPartial(funding.partial)}>
                  Repay {formatAmount(funding.partial, decimals)} {symbol} (wallet balance) instead
                </button>
              </div>
            )}
            {plan?.full && funding?.fundable && (
              <p className="text-xs text-muted-foreground mt-1">
                Full repay: the pool takes your debt as of the repay block (accrual until then is covered).
              </p>
            )}
            {notice && <TxNotice testId="repay-notice">{notice}</TxNotice>}
            {!preview && (
              <div className="mt-1">
                <FreshnessStamp stamp={core.stamp} label="Position" />
              </div>
            )}
          </AmountField>

          {preview && (
            <CoreRiskSummary
              preview={preview}
              apy={coreApy(core.getMarket(asset)?.borrowRate)}
              apyLabel="Borrow APY"
              invalid={shortForPartial ? "more than your wallet balance" : null}
              stamp={core.stamp}
            />
          )}

          <TxSteps
            steps={flow.steps}
            approvalNeeded={needsApproval}
            approveAmount={plan && needsApproval ? plan.approve : undefined}
            symbol={symbol}
            decimals={decimals}
            actionLabel={`Repay ${symbol}`}
            action={tx}
            ctx={CTX}
          />
          {allowanceNote}

          <TxButton
            onClick={handleRepay}
            isPending={tx.isPending || flow.isPending}
            isSimulating={tx.isSimulating || flow.isSimulating}
            isConfirming={tx.isConfirming || flow.isConfirming || flow.awaitingApproval}
            isChecking={flow.isChecking}
            disabled={!address || !plan || walletValue === undefined || shortForPartial || (funding !== null && !funding.fundable)}
          >
            {needsApproval ? `Approve ${symbol}` : `Repay ${symbol}`}
          </TxButton>

          <TxDetails calls={plan ? [needsApproval ? flow.describeApprove(plan.approve) : null, previewCall(repayRequest(plan.amountArg))] : []} />
        </TxForm>
      )}
    </TxDialog>
  );
}
