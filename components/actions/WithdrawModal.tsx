"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { safeParseUnits } from "@/lib/format";
import { AAVE_ENTIRE_BALANCE } from "@/lib/approvals";
import { coreApy, corePreview } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { useLuminaWrite } from "@/hooks/chain";
import { TxButton } from "@/components/common/TxButton";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { AmountField, TxDialog, TxForm, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { CoreRiskSummary } from "@/components/tx/TxSummary";
import { TxDetails } from "@/components/tx/TxDetails";
import { CoreAfterState, previewCall } from "@/components/tx/AfterStates";
import { useCoreRiskInputs } from "@/components/tx/reads";
import { formatToken } from "@/components/tx/format";

interface WithdrawModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

const CTX: TxErrorContext = { venue: "core", action: "withdraw" };

/**
 * Core withdraw. MAX sets a "withdraw all" intent, kept apart from the amount text until the user
 * edits it; with it the withdraw sends Aave's entire-balance sentinel, so interest accrued after
 * the last poll is withdrawn too and no dust aTokens remain (FE-09, Codex #5).
 */
export function WithdrawModal({ asset, symbol, decimals, onClose }: WithdrawModalProps) {
  const [amount, setAmount] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const tx = useLuminaWrite();
  const core = useCoreRiskInputs();

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;
  const position = core.positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase());
  const supplied = position?.supplied;
  const suppliedFormatted = supplied === undefined ? "" : formatUnits(supplied, decimals);
  const shownAmount = withdrawAll && supplied !== undefined ? suppliedFormatted : amount;
  // With the intent, what leaves is the whole (polled) balance.
  const effectiveAmount = withdrawAll ? (supplied ?? 0n) : parsedAmount;
  const liquidity = core.getMarket(asset)?.availableLiquidity;
  const overSupplied = supplied !== undefined && !withdrawAll && parsedAmount > supplied;

  useTxErrorToast(tx.error, "Withdrawal failed", CTX);
  useTxSuccessToast(tx.isSuccess, tx.hash, "Withdrawal successful");

  const withdrawRequest = () => ({
    address: pool ?? ("" as `0x${string}`),
    abi: POOL_ABI,
    functionName: "withdraw",
    args: [asset, withdrawAll ? AAVE_ENTIRE_BALANCE : parsedAmount, address],
  });

  const handleWithdraw = () => {
    if (!address || !pool || effectiveAmount === 0n) return;
    void tx.send(withdrawRequest());
  };

  const preview =
    withdrawAll || parsedAmount > 0n
      ? corePreview(core.snapshot, { kind: "withdraw", asset, amount: withdrawAll ? "all" : parsedAmount })
      : null;

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess
          title="Withdrawal Successful"
          message={`You withdrew ${withdrawAll ? "all your" : amount} ${symbol}`}
          hash={tx.hash}
          onClose={onClose}
        >
          <CoreAfterState core={core} receiptBlock={tx.receipt?.blockNumber} />
        </TxSuccess>
      ) : (
        <TxForm title={`Withdraw ${symbol}`}>
          <AmountField
            label="Amount"
            aside={<>Supplied: <span className="font-mono">{supplied === undefined ? "—" : formatToken(supplied, decimals, symbol)}</span></>}
            value={shownAmount}
            decimals={decimals}
            onChange={(v) => {
              setWithdrawAll(false);
              setAmount(v);
            }}
            onMax={() => {
              setWithdrawAll(true);
              setAmount(suppliedFormatted);
            }}
            maxDisabled={supplied === undefined || supplied === 0n}
          >
            {withdrawAll && <p className="text-xs text-accent mt-1">Withdraw all: the whole balance at execution, interest included.</p>}
            {overSupplied && <p className="text-xs text-destructive mt-1">Amount exceeds supplied balance</p>}
            {liquidity !== undefined && effectiveAmount > liquidity && (
              <p className="text-xs text-warning mt-1">Exceeds the reserve&apos;s available liquidity</p>
            )}
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
              invalid={overSupplied ? "more than your supplied balance" : null}
              stamp={core.stamp}
            />
          )}

          <TxButton
            onClick={handleWithdraw}
            isPending={tx.isPending}
            isSimulating={tx.isSimulating}
            isConfirming={tx.isConfirming}
            disabled={!address || supplied === undefined || effectiveAmount === 0n || overSupplied}
          >
            Withdraw {symbol}
          </TxButton>

          <TxDetails calls={effectiveAmount > 0n ? [previewCall(withdrawRequest())] : []} />
        </TxForm>
      )}
    </TxDialog>
  );
}
