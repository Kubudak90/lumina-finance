"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow, type FollowUpResult } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { exactApproval } from "@/lib/approvals";
import { abortFollowUp, cancelFollowUp } from "@/lib/approvalFlow";
import { aprToApy, isolatedPreview } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { safeParseUnits } from "@/lib/format";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { AmountField, TxDialog, TxForm, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { IsolatedRiskSummary } from "@/components/tx/TxSummary";
import { TxSteps } from "@/components/tx/TxSteps";
import { TxDetails } from "@/components/tx/TxDetails";
import { IsolatedAfterState, previewCall } from "@/components/tx/AfterStates";
import { useIsolatedAccountRead } from "@/components/tx/reads";
import { formatToken } from "@/components/tx/format";
import { isolatedSides } from "@/components/tx/isolated";

const CTX: TxErrorContext = { venue: "isolated", action: "addCollateral" };

/**
 * LightlendPair.addCollateral(amount, borrower) with an exact approval. Works while the price
 * guard blocks borrows (spec §5.4), so a borrower can always top up instead of being liquidated.
 */
export function IsolatedAddCollateralModal({ pair, onClose }: { pair: `0x${string}`; onClose: () => void }) {
  const info = useIsolatedPair(pair);
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const collateral = info?.collateral;
  const collateralSymbol = info?.collateralSymbol ?? "";
  const collateralDecimals = info?.collateralDecimals ?? 18;
  const wallet = useWalletBalance(collateral);
  const tx = useLuminaWrite();
  const read = useIsolatedAccountRead(pair, info?.dualOracle, address);
  const sides = isolatedSides(info);

  const parsed = amount ? (safeParseUnits(amount, collateralDecimals) ?? 0n) : 0n;
  const balanceRaw = wallet.value;
  const overBalance = balanceRaw !== undefined && parsed > balanceRaw;

  const addRequest = (value: bigint) => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "addCollateral",
    args: [value, address],
  });

  const sendAdd = async ({ amount: value }: { amount: bigint }): Promise<FollowUpResult> => {
    if (!address) return;
    const walletNow = await wallet.fetchNow();
    if (walletNow === undefined || walletNow < value) {
      toast.error("Not sent", { description: "Your wallet balance no longer covers the amount." });
      return abortFollowUp("your wallet balance no longer covers the amount");
    }
    // The account, chain and inputs must still be the ones this follow-up started with.
    const stale = flow.stale();
    if (stale) return cancelFollowUp(stale);
    await tx.send(addRequest(value));
  };

  const flow = useApprovalFlow<{ amount: bigint }>({
    token: collateral ?? pair,
    spender: collateral ? pair : null,
    paramsKey: amount,
    onProceed: sendAdd,
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });
  const needsApproval = parsed > 0n && flow.needsApproval(parsed);

  useTxErrorToast(tx.error, "Add collateral failed", CTX);
  useTxErrorToast(flow.error, "Approval failed", { venue: "isolated", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Collateral added", `Added ${amount} ${collateralSymbol}`);

  const handleAdd = () => {
    if (!address || parsed === 0n) return;
    if (needsApproval) {
      // Add-collateral approves exactly the amount added (FE-04).
      void flow.start({ amount: parsed }, exactApproval(parsed));
      return;
    }
    void flow.proceed({ amount: parsed });
  };

  const preview = parsed > 0n && sides ? isolatedPreview(read.state, { kind: "addCollateral", amount: parsed }, sides) : null;
  const allowanceNote = (
    <AllowanceNote
      symbol={collateralSymbol}
      decimals={collateralDecimals}
      spenderLabel="pair"
      allowance={flow.allowance}
      approveAmount={needsApproval ? parsed : undefined}
    />
  );

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess title={`Added ${amount} ${collateralSymbol}`} hash={tx.hash} onClose={onClose}>
          {sides && <IsolatedAfterState read={read} sides={sides} receiptBlock={tx.receipt?.blockNumber} />}
          <PostTxAllowance refetch={flow.refetchAllowance} symbol={collateralSymbol} decimals={collateralDecimals} spenderLabel="pair" />
        </TxSuccess>
      ) : (
        <TxForm title={`Add ${collateralSymbol} Collateral`}>
          <p className="text-sm text-muted-foreground">
            Post more {collateralSymbol} to lower your LTV in this pair. Allowed even while borrowing is blocked.
          </p>
          <AmountField
            label="Amount"
            aside={<>Wallet: <span className="font-mono">{balanceRaw === undefined ? "—" : formatToken(balanceRaw, collateralDecimals, collateralSymbol)}</span></>}
            value={amount}
            decimals={collateralDecimals}
            onChange={setAmount}
            onMax={() => balanceRaw !== undefined && setAmount(formatUnits(balanceRaw, collateralDecimals))}
            maxDisabled={balanceRaw === undefined}
          >
            {overBalance && <p className="text-xs text-destructive mt-1">Insufficient balance</p>}
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
              invalid={overBalance ? "more than your wallet balance" : null}
              stamp={read.stamp}
            />
          )}

          <TxSteps
            steps={flow.steps}
            approvalNeeded={needsApproval}
            approveAmount={needsApproval ? parsed : undefined}
            symbol={collateralSymbol}
            decimals={collateralDecimals}
            actionLabel={`Add ${collateralSymbol}`}
            action={tx}
            ctx={CTX}
          />
          {allowanceNote}

          <TxButton
            onClick={handleAdd}
            isPending={tx.isPending || flow.isPending}
            isSimulating={tx.isSimulating || flow.isSimulating}
            isConfirming={tx.isConfirming || flow.isConfirming || flow.awaitingApproval}
            isChecking={flow.isChecking}
            disabled={!address || !info || parsed === 0n || balanceRaw === undefined || overBalance}
          >
            {needsApproval ? `Approve ${collateralSymbol}` : `Add ${collateralSymbol}`}
          </TxButton>

          <TxDetails calls={parsed > 0n ? [needsApproval ? flow.describeApprove(parsed) : null, previewCall(addRequest(parsed))] : []} />
        </TxForm>
      )}
    </TxDialog>
  );
}
