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
import { aprToApy } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { safeParseUnits } from "@/lib/format";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { AmountField, TxDialog, TxForm, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { LenderSummary } from "@/components/tx/TxSummary";
import { TxSteps } from "@/components/tx/TxSteps";
import { TxDetails } from "@/components/tx/TxDetails";
import { LenderAfterState, previewCall } from "@/components/tx/AfterStates";
import { useIsolatedAccountRead } from "@/components/tx/reads";
import { formatToken } from "@/components/tx/format";

const CTX: TxErrorContext = { venue: "isolated", action: "lend" };

/** Lend (deposit) into an isolated pair; exact approval. Pair data is re-derived on every render. */
export function IsolatedLendModal({ pair, onClose }: { pair: `0x${string}`; onClose: () => void }) {
  const info = useIsolatedPair(pair);
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const asset = info?.asset;
  const assetSymbol = info?.assetSymbol ?? "";
  const assetDecimals = info?.assetDecimals ?? 18;
  const wallet = useWalletBalance(asset);
  const tx = useLuminaWrite();
  const read = useIsolatedAccountRead(pair, info?.dualOracle, address);

  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const balanceRaw = wallet.value;
  const overBalance = balanceRaw !== undefined && parsed > balanceRaw;

  const depositRequest = (value: bigint) => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "deposit",
    args: [value, address],
  });

  const sendDeposit = async ({ amount: value }: { amount: bigint }): Promise<FollowUpResult> => {
    if (!address) return;
    const walletNow = await wallet.fetchNow();
    if (walletNow === undefined || walletNow < value) {
      toast.error("Deposit not sent", { description: "Your wallet balance no longer covers the amount." });
      return abortFollowUp("your wallet balance no longer covers the amount");
    }
    // The account, chain and inputs must still be the ones this follow-up started with.
    const stale = flow.stale();
    if (stale) return cancelFollowUp(stale);
    await tx.send(depositRequest(value));
  };

  const flow = useApprovalFlow<{ amount: bigint }>({
    token: asset ?? pair,
    spender: asset ? pair : null,
    paramsKey: amount,
    onProceed: sendDeposit,
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });
  const needsApproval = parsed > 0n && flow.needsApproval(parsed);

  useTxErrorToast(tx.error, "Lend failed", CTX);
  useTxErrorToast(flow.error, "Approval failed", { venue: "isolated", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Asset deposited", `Lent ${amount} ${assetSymbol}`);

  const handleLend = () => {
    if (!address || parsed === 0n) return;
    if (needsApproval) {
      // Deposit approves exactly the amount deposited (FE-04).
      void flow.start({ amount: parsed }, exactApproval(parsed));
      return;
    }
    void flow.proceed({ amount: parsed });
  };

  const allowanceNote = (
    <AllowanceNote
      symbol={assetSymbol}
      decimals={assetDecimals}
      spenderLabel="pair"
      allowance={flow.allowance}
      approveAmount={needsApproval ? parsed : undefined}
    />
  );

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess title={`Lent ${amount} ${assetSymbol}`} hash={tx.hash} onClose={onClose}>
          <LenderAfterState read={read} symbol={assetSymbol} decimals={assetDecimals} receiptBlock={tx.receipt?.blockNumber} />
          <PostTxAllowance refetch={flow.refetchAllowance} symbol={assetSymbol} decimals={assetDecimals} spenderLabel="pair" />
        </TxSuccess>
      ) : (
        <TxForm title={`Lend ${assetSymbol}`}>
          <p className="text-sm text-muted-foreground">Deposit {assetSymbol} to earn yield from borrowers in this isolated pair.</p>
          <AmountField
            label="Amount"
            aside={<>Wallet: <span className="font-mono">{balanceRaw === undefined ? "—" : formatToken(balanceRaw, assetDecimals, assetSymbol)}</span></>}
            value={amount}
            decimals={assetDecimals}
            onChange={setAmount}
            onMax={() => balanceRaw !== undefined && setAmount(formatUnits(balanceRaw, assetDecimals))}
            maxDisabled={balanceRaw === undefined}
          >
            {overBalance && <p className="text-xs text-destructive mt-1">Insufficient balance</p>}
          </AmountField>

          {parsed > 0n && (
            <LenderSummary
              before={read.lent}
              after={read.lent === undefined ? undefined : read.lent + parsed}
              symbol={assetSymbol}
              decimals={assetDecimals}
              apy={info?.lendApr === undefined ? undefined : aprToApy(info.lendApr)}
              invalid={overBalance ? "more than your wallet balance" : null}
            />
          )}

          <TxSteps
            steps={flow.steps}
            approvalNeeded={needsApproval}
            approveAmount={needsApproval ? parsed : undefined}
            symbol={assetSymbol}
            decimals={assetDecimals}
            actionLabel={`Lend ${assetSymbol}`}
            action={tx}
            ctx={CTX}
          />
          {allowanceNote}

          <TxButton
            onClick={handleLend}
            isPending={tx.isPending || flow.isPending}
            isSimulating={tx.isSimulating || flow.isSimulating}
            isConfirming={tx.isConfirming || flow.isConfirming || flow.awaitingApproval}
            isChecking={flow.isChecking}
            disabled={!address || !info || parsed === 0n || balanceRaw === undefined || overBalance}
          >
            {needsApproval ? `Approve ${assetSymbol}` : `Lend ${assetSymbol}`}
          </TxButton>

          <TxDetails calls={parsed > 0n ? [needsApproval ? flow.describeApprove(parsed) : null, previewCall(depositRequest(parsed))] : []} />
        </TxForm>
      )}
    </TxDialog>
  );
}
