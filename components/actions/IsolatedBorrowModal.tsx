"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { useIsolatedPosition } from "@/hooks/useUserIsolatedPositions";
import { useGuardStatus } from "@/hooks/useGuardStatus";
import { useIsolatedFreshReads } from "@/hooks/useIsolatedFreshReads";
import { exactApproval } from "@/lib/approvals";
import { abortFollowUp, type FollowUpAbort } from "@/lib/approvalFlow";
import { isolatedBorrowMaxFromReads } from "@/lib/borrowMax";
import { GUARD_BLOCKED_NOTE } from "@/lib/guard";
import { aprToApy, formatMaxLtvPercent, isolatedPreview } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { safeParseUnits } from "@/lib/format";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { GuardNotice } from "@/components/common/GuardNotice";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { AmountField, TxDialog, TxForm, TxNotice, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { IsolatedRiskSummary, SummaryRow } from "@/components/tx/TxSummary";
import { TxSteps } from "@/components/tx/TxSteps";
import { TxDetails } from "@/components/tx/TxDetails";
import { IsolatedAfterState, previewCall } from "@/components/tx/AfterStates";
import { useIsolatedAccountRead } from "@/components/tx/reads";
import { formatToken } from "@/components/tx/format";
import { isolatedSides } from "@/components/tx/isolated";

type BorrowParams = { borrow: bigint; collateral: bigint };

/**
 * Post collateral (exact approval) and borrow in one transaction. Everything risk-related — the
 * pair's rate, maxLTV, liquidity, the guard and the user's debt — is re-derived from the polled
 * data on every render and re-checked after the approval (Codex #8). MAX uses the pair's maxLTV and
 * oracle exchange rate with a 99% haircut (FE-05) and is "unavailable" when an input is missing.
 */
export function IsolatedBorrowModal({ pair, onClose }: { pair: `0x${string}`; onClose: () => void }) {
  const info = useIsolatedPair(pair);
  const positionState = useIsolatedPosition(pair);
  const position = positionState.position;
  const fresh = useIsolatedFreshReads();
  const guard = useGuardStatus();
  const [collateralInput, setCollateralInput] = useState("");
  const [borrowInput, setBorrowInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();
  const ctx: TxErrorContext = { venue: "isolated", action: "borrow", guardStatus: guard.key };

  const assetSymbol = info?.assetSymbol ?? "";
  const assetDecimals = info?.assetDecimals ?? 18;
  const collateral = info?.collateral;
  const collateralSymbol = info?.collateralSymbol ?? "";
  const collateralDecimals = info?.collateralDecimals ?? 18;
  const wallet = useWalletBalance(collateral);
  const tx = useLuminaWrite();
  const read = useIsolatedAccountRead(pair, info?.dualOracle, address);
  const sides = isolatedSides(info);

  const parsedCollateral = collateralInput ? (safeParseUnits(collateralInput, collateralDecimals) ?? 0n) : 0n;
  const parsedBorrow = borrowInput ? (safeParseUnits(borrowInput, assetDecimals) ?? 0n) : 0n;
  const collateralBalanceRaw = wallet.value;

  // Position unknown (snapshot loading or failed) = collateral and debt unknown, never 0 (Gemini r2
  // M4). Known with no position = none; known with a failed debt conversion = debt unknown.
  const known = positionState.status === "known";
  const currentCollateral = known ? (position?.collateralAmount ?? 0n) : undefined;
  const currentDebt = known ? (position ? position.borrowedAssets : 0n) : undefined;
  const rate = info?.exchangeRate;
  const borrowBlocked = !guard.borrowAllowed || info?.oracleBadData !== false;

  const maxFor = (extraCollateral: bigint) =>
    isolatedBorrowMaxFromReads({
      collateral: currentCollateral === undefined ? undefined : currentCollateral + extraCollateral,
      currentDebt,
      exchangeRate: rate,
      maxLtv: info?.maxLTV,
      availableLiquidity: info?.availableLiquidity,
      borrowLimit: info?.borrowLimit,
      totalBorrow: info?.totalBorrowAmount,
    });
  const maxBorrow = maxFor(parsedCollateral);
  const maxLtvPercent = info?.maxLTV === undefined ? "—" : formatMaxLtvPercent(info.maxLTV);
  const overMax = maxBorrow !== null && parsedBorrow > maxBorrow;
  const insufficientCollateral = collateralBalanceRaw !== undefined && parsedCollateral > collateralBalanceRaw;

  const borrowRequest = (params: BorrowParams) => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "borrowAsset",
    args: [params.borrow, params.collateral, address],
  });

  const stop = (text: string, reason: string, reapprove = false) => {
    setNotice(text);
    return abortFollowUp(reason, reapprove);
  };

  const sendBorrow = async (params: BorrowParams): Promise<FollowUpAbort | void> => {
    if (!address || !info || !collateral) return;
    setNotice(null);
    try {
      // From the chain, not the poll cache (Gemini r2 M3): the user's position, the pair's rate,
      // oracle flag and limits, the guard, and the collateral allowance and wallet.
      const [state, risk] = await Promise.all([
        fresh.accountState(pair, address, collateral, address),
        fresh.pairRisk(pair, info.dualOracle),
      ]);
      if (!risk.guardOk || risk.oracleBadData) {
        return stop(`Borrowing became blocked; nothing was sent. ${GUARD_BLOCKED_NOTE.isolated}`, "the price guard tripped during the approval");
      }
      const debtNow = await fresh.shareValue(pair, state.borrowShares);
      const maxNow = isolatedBorrowMaxFromReads({
        collateral: state.collateral + params.collateral,
        currentDebt: debtNow,
        exchangeRate: risk.exchangeRate,
        maxLtv: risk.maxLtv,
        availableLiquidity: risk.totalAssetAmount > risk.totalBorrowAmount ? risk.totalAssetAmount - risk.totalBorrowAmount : 0n,
        borrowLimit: risk.borrowLimit,
        totalBorrow: risk.totalBorrowAmount,
      });
      if (maxNow === null || params.borrow > maxNow) {
        return stop("The borrow no longer fits the pair's limits at the current rate; nothing was sent.", "the amount no longer fits the pair's limits");
      }
      if (params.collateral > 0n && (state.wallet < params.collateral || state.allowance < params.collateral)) {
        return stop(
          "Your collateral balance or allowance no longer covers the amount; nothing was sent.",
          "the collateral wallet or allowance no longer covers it",
          state.allowance < params.collateral,
        );
      }
      await tx.send(borrowRequest(params));
    } catch (err) {
      return stop(`Re-check failed (${(err as Error).message}); nothing was sent.`, "the re-check could not read the chain");
    }
  };

  const flow = useApprovalFlow<BorrowParams>({
    token: collateral ?? pair,
    spender: collateral ? pair : null,
    paramsKey: `${collateralInput}|${borrowInput}`,
    onProceed: sendBorrow,
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });
  const needsCollateralApproval = parsedCollateral > 0n && flow.needsApproval(parsedCollateral);

  useTxErrorToast(tx.error, "Borrow failed", ctx);
  useTxErrorToast(flow.error, "Approval failed", { venue: "isolated", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Borrow successful", `Borrowed ${borrowInput} ${assetSymbol}`);

  const handleBorrow = () => {
    if (!address || parsedBorrow === 0n) return;
    const params = { borrow: parsedBorrow, collateral: parsedCollateral };
    if (needsCollateralApproval) {
      // Add-collateral approves exactly the collateral posted (FE-04).
      void flow.start(params, exactApproval(parsedCollateral));
      return;
    }
    void flow.proceed(params);
  };

  const hasInput = parsedBorrow > 0n || parsedCollateral > 0n;
  const preview = hasInput && sides ? isolatedPreview(read.state, { kind: "borrow", amount: parsedBorrow, collateral: parsedCollateral }, sides) : null;
  const allowanceNote = parsedCollateral > 0n && (
    <AllowanceNote
      symbol={collateralSymbol}
      decimals={collateralDecimals}
      spenderLabel="pair"
      allowance={flow.allowance}
      approveAmount={needsCollateralApproval ? parsedCollateral : undefined}
    />
  );
  const params = { borrow: parsedBorrow, collateral: parsedCollateral };

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess title="Borrow Successful" message={`Borrowed ${borrowInput} ${assetSymbol}`} hash={tx.hash} onClose={onClose}>
          {sides && <IsolatedAfterState read={read} sides={sides} receiptBlock={tx.receipt?.blockNumber} />}
          {parsedCollateral > 0n && (
            <PostTxAllowance refetch={flow.refetchAllowance} symbol={collateralSymbol} decimals={collateralDecimals} spenderLabel="pair" />
          )}
        </TxSuccess>
      ) : (
        <TxForm title={`Borrow ${assetSymbol} (collateral: ${collateralSymbol})`}>
          <GuardNotice venue="isolated" />
          {borrowBlocked && info?.oracleBadData === undefined && (
            <p className="text-xs text-amber-400">Pair oracle unavailable; borrowing is disabled. {GUARD_BLOCKED_NOTE.isolated}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Post {collateralSymbol} as collateral and borrow {assetSymbol} in one transaction. Max LTV in this pair is {maxLtvPercent}.
          </p>

          <AmountField
            label={`Add collateral (${collateralSymbol})`}
            aside={<>Wallet: <span className="font-mono">{collateralBalanceRaw === undefined ? "—" : formatToken(collateralBalanceRaw, collateralDecimals, collateralSymbol)}</span></>}
            value={collateralInput}
            decimals={collateralDecimals}
            onChange={setCollateralInput}
            ariaLabel="Collateral"
          >
            {positionState.status === "unknown" && (
              <p className="text-xs text-amber-400 mt-1" data-testid="position-unknown">
                Your position in this pair could not be read; MAX and borrowing are unavailable until it loads.
              </p>
            )}
            {currentCollateral !== undefined && currentCollateral > 0n && (
              <p className="text-xs text-muted-foreground mt-1">Already posted: {formatToken(currentCollateral, collateralDecimals, collateralSymbol)}</p>
            )}
            {insufficientCollateral && <p className="text-xs text-destructive mt-1">Insufficient {collateralSymbol} balance</p>}
          </AmountField>

          <AmountField
            label={`Borrow (${assetSymbol})`}
            aside={
              <>
                Max (99%):{" "}
                <span className="font-mono" data-testid="borrow-max">
                  {maxBorrow === null ? "unavailable" : formatToken(maxBorrow, assetDecimals, assetSymbol)}
                </span>
              </>
            }
            value={borrowInput}
            decimals={assetDecimals}
            onChange={setBorrowInput}
            onMax={() => maxBorrow !== null && setBorrowInput(formatUnits(maxBorrow, assetDecimals))}
            maxDisabled={maxBorrow === null}
            ariaLabel="Borrow"
          >
            {overMax && parsedBorrow > 0n && <p className="text-xs text-destructive mt-1">Exceeds max LTV, pair liquidity or borrow limit</p>}
            {notice && <TxNotice>{notice}</TxNotice>}
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
              invalid={
                overMax
                  ? "more than you can borrow (max LTV, liquidity or limit)"
                  : insufficientCollateral
                    ? `more ${collateralSymbol} than your wallet holds`
                    : null
              }
              stamp={read.stamp}
            />
          )}

          <TxSteps
            steps={flow.steps}
            approvalNeeded={needsCollateralApproval}
            approveAmount={needsCollateralApproval ? parsedCollateral : undefined}
            symbol={collateralSymbol}
            decimals={collateralDecimals}
            actionLabel={`Borrow ${assetSymbol}`}
            action={tx}
            ctx={ctx}
          />
          {needsCollateralApproval && allowanceNote}

          <TxButton
            onClick={handleBorrow}
            isPending={tx.isPending || flow.isPending}
            isSimulating={tx.isSimulating || flow.isSimulating}
            isConfirming={tx.isConfirming || flow.isConfirming || flow.awaitingApproval}
            disabled={!address || !info || parsedBorrow === 0n || insufficientCollateral || overMax || maxBorrow === null || borrowBlocked}
          >
            {borrowBlocked ? "Borrowing blocked" : needsCollateralApproval ? `Approve ${collateralSymbol}` : `Borrow ${assetSymbol}`}
          </TxButton>

          <TxDetails
            calls={parsedBorrow > 0n ? [needsCollateralApproval ? flow.describeApprove(parsedCollateral) : null, previewCall(borrowRequest(params))] : []}
          >
            <SummaryRow
              label="Pair liquidity"
              before={info?.availableLiquidity === undefined ? "unavailable" : formatToken(info.availableLiquidity, assetDecimals, assetSymbol)}
            />
            {!needsCollateralApproval && allowanceNote}
          </TxDetails>
        </TxForm>
      )}
    </TxDialog>
  );
}
