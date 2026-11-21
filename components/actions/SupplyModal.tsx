"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { safeParseUnits } from "@/lib/format";
import { exactApproval } from "@/lib/approvals";
import { abortFollowUp } from "@/lib/approvalFlow";
import { coreApy, corePreview } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { TxButton } from "@/components/common/TxButton";
import { AmountField, TxDialog, TxForm, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { CoreRiskSummary } from "@/components/tx/TxSummary";
import { TxSteps } from "@/components/tx/TxSteps";
import { TxDetails } from "@/components/tx/TxDetails";
import { CoreAfterState, previewCall } from "@/components/tx/AfterStates";
import { useCoreRiskInputs } from "@/components/tx/reads";
import { formatToken } from "@/components/tx/format";

interface SupplyModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

const CTX: TxErrorContext = { venue: "core", action: "supply" };

export function SupplyModal({ asset, symbol, decimals, onClose }: SupplyModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const tx = useLuminaWrite();
  const wallet = useWalletBalance(asset);
  const core = useCoreRiskInputs();

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;
  const balance = wallet.value;

  const supplyRequest = (value: bigint) => ({
    address: pool ?? ("" as `0x${string}`),
    abi: POOL_ABI,
    functionName: "supply",
    args: [asset, value, address, 0],
  });

  const sendSupply = async (value: bigint) => {
    if (!address || !pool) return;
    // Re-validate against the chain right before the wallet prompt.
    const walletNow = await wallet.fetchNow();
    if (walletNow === undefined || walletNow < value) {
      toast.error("Supply not sent", { description: "Your wallet balance no longer covers the amount." });
      return abortFollowUp("your wallet balance no longer covers the amount");
    }
    await tx.send(supplyRequest(value));
  };

  const flow = useApprovalFlow<{ amount: bigint }>({
    token: asset,
    spender: pool,
    paramsKey: amount,
    onProceed: ({ amount: value }) => sendSupply(value),
    actionBusy: tx.isSimulating || tx.isPending || tx.isConfirming,
  });

  useTxErrorToast(tx.error, "Supply failed", CTX);
  useTxErrorToast(flow.error, "Approval failed", { venue: "core", action: "approve" });
  useTxSuccessToast(tx.isSuccess, tx.hash, "Supply successful");

  const needsApproval = parsedAmount > 0n && flow.needsApproval(parsedAmount);
  const overBalance = balance !== undefined && parsedAmount > balance;

  const handleSupply = () => {
    if (!address || !pool || parsedAmount === 0n) return;
    if (needsApproval) {
      // Supply approves exactly the amount supplied (FE-04).
      void flow.start({ amount: parsedAmount }, exactApproval(parsedAmount));
      return;
    }
    void flow.proceed({ amount: parsedAmount });
  };

  const preview = parsedAmount > 0n ? corePreview(core.snapshot, { kind: "supply", asset, amount: parsedAmount }) : null;
  const allowanceNote = (
    <AllowanceNote
      symbol={symbol}
      decimals={decimals}
      spenderLabel="Pool"
      allowance={flow.allowance}
      approveAmount={needsApproval ? parsedAmount : undefined}
    />
  );

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess title="Supply Successful" message={`You supplied ${amount} ${symbol}`} hash={tx.hash} onClose={onClose}>
          <CoreAfterState core={core} receiptBlock={tx.receipt?.blockNumber} />
          <PostTxAllowance refetch={flow.refetchAllowance} symbol={symbol} decimals={decimals} spenderLabel="Pool" />
        </TxSuccess>
      ) : (
        <TxForm title={`Supply ${symbol}`}>
          <AmountField
            label="Amount"
            aside={<>Wallet: <span className="font-mono">{balance === undefined ? "—" : formatToken(balance, decimals, symbol)}</span></>}
            value={amount}
            decimals={decimals}
            onChange={setAmount}
            onMax={() => balance !== undefined && setAmount(formatUnits(balance, decimals))}
            maxDisabled={balance === undefined}
          >
            {overBalance && <p className="text-xs text-destructive mt-1">Insufficient balance</p>}
            {!preview && (
              <div className="mt-1">
                <FreshnessStamp stamp={core.stamp} label="Position" />
              </div>
            )}
          </AmountField>

          {preview && (
            <CoreRiskSummary
              preview={preview}
              apy={coreApy(core.getMarket(asset)?.supplyRate)}
              apyLabel="Supply APY"
              invalid={overBalance ? "more than your wallet balance" : null}
              stamp={core.stamp}
            />
          )}

          <TxSteps
            steps={flow.steps}
            approvalNeeded={needsApproval}
            approveAmount={needsApproval ? parsedAmount : undefined}
            symbol={symbol}
            decimals={decimals}
            actionLabel={`Supply ${symbol}`}
            action={tx}
            ctx={CTX}
          />
          {allowanceNote}

          <TxButton
            onClick={handleSupply}
            isPending={tx.isPending || flow.isPending}
            isSimulating={tx.isSimulating || flow.isSimulating}
            isConfirming={tx.isConfirming || flow.isConfirming || flow.awaitingApproval}
            disabled={!address || parsedAmount === 0n || balance === undefined || overBalance}
          >
            {needsApproval ? `Approve ${symbol}` : `Supply ${symbol}`}
          </TxButton>

          <TxDetails
            calls={
              parsedAmount > 0n
                ? [needsApproval ? flow.describeApprove(parsedAmount) : null, previewCall(supplyRequest(parsedAmount))]
                : []
            }
          />
        </TxForm>
      )}
    </TxDialog>
  );
}
