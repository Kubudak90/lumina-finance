"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { safeParseUnits } from "@/lib/format";
import { coreBorrowMaxFromReads } from "@/lib/borrowMax";
import { coreApy, corePreview } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { useLuminaWrite } from "@/hooks/chain";
import { useGuardStatus } from "@/hooks/useGuardStatus";
import { TxButton } from "@/components/common/TxButton";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { GuardNotice } from "@/components/common/GuardNotice";
import { AmountField, TxDialog, TxForm, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { CoreRiskSummary, SummaryRow } from "@/components/tx/TxSummary";
import { TxDetails } from "@/components/tx/TxDetails";
import { CoreAfterState, previewCall } from "@/components/tx/AfterStates";
import { useCoreRiskInputs } from "@/components/tx/reads";
import { formatToken } from "@/components/tx/format";

interface BorrowModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function BorrowModal({ asset, symbol, decimals, onClose }: BorrowModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const tx = useLuminaWrite();
  const core = useCoreRiskInputs();
  const guard = useGuardStatus();
  const ctx: TxErrorContext = { venue: "core", action: "borrow", guardStatus: guard.key };

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;
  const market = core.getMarket(asset);
  const price = core.priceOf(asset);
  const accountData = core.accountData;
  const availableLiquidity = market?.availableLiquidity;

  // FE-05: LTV-based capacity (availableBorrowsBase), 99% haircut, capped by liquidity and the
  // borrow cap, in bigint, floored to base units. null ("unavailable") when any input read failed
  // or is still loading — never computed from a missing value (Codex #9).
  const maxBorrow = coreBorrowMaxFromReads({
    availableBorrowsBase: accountData?.availableBorrowsBase,
    assetPriceBase: price,
    decimals,
    availableLiquidity,
    borrowCapTokens: market?.borrowCap,
    totalDebt: market?.totalDebt,
  });
  const capacityTokens =
    accountData && price !== undefined && price > 0n
      ? (accountData.availableBorrowsBase * 10n ** BigInt(decimals)) / price
      : undefined;
  const overMax = maxBorrow !== null && parsedAmount > maxBorrow;

  useTxErrorToast(tx.error, "Borrow failed", ctx);
  useTxSuccessToast(tx.isSuccess, tx.hash, "Borrow successful");

  const borrowRequest = () => ({
    address: pool ?? ("" as `0x${string}`),
    abi: POOL_ABI,
    functionName: "borrow",
    args: [asset, parsedAmount, 2n, 0, address],
  });

  const handleBorrow = () => {
    if (!address || !pool) return;
    void tx.send(borrowRequest());
  };

  const preview = parsedAmount > 0n ? corePreview(core.snapshot, { kind: "borrow", asset, amount: parsedAmount }) : null;

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess title="Borrow Successful" message={`You borrowed ${amount} ${symbol}`} hash={tx.hash} onClose={onClose}>
          <CoreAfterState core={core} receiptBlock={tx.receipt?.blockNumber} />
        </TxSuccess>
      ) : (
        <TxForm title={`Borrow ${symbol}`}>
          <GuardNotice venue="core" />

          <AmountField
            label="Amount"
            aside={
              <>
                Max (99%):{" "}
                <span className="font-mono" data-testid="borrow-max">
                  {maxBorrow === null ? "unavailable" : formatToken(maxBorrow, decimals, symbol)}
                </span>
              </>
            }
            value={amount}
            decimals={decimals}
            onChange={setAmount}
            onMax={() => maxBorrow !== null && setAmount(formatUnits(maxBorrow, decimals))}
            maxDisabled={maxBorrow === null}
          >
            {overMax && parsedAmount > 0n && (
              <p className="text-xs text-destructive mt-1">Amount exceeds what you can borrow (LTV, liquidity or cap)</p>
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
              apy={coreApy(market?.borrowRate)}
              apyLabel="Borrow APY"
              invalid={overMax ? "more than you can borrow (LTV, liquidity or cap)" : null}
              stamp={core.stamp}
            />
          )}

          <TxButton
            onClick={handleBorrow}
            isPending={tx.isPending}
            isSimulating={tx.isSimulating}
            isConfirming={tx.isConfirming}
            disabled={!address || parsedAmount === 0n || overMax || !guard.borrowAllowed}
          >
            {!guard.borrowAllowed ? "Borrowing blocked" : `Borrow ${symbol}`}
          </TxButton>

          <TxDetails calls={parsedAmount > 0n ? [previewCall(borrowRequest())] : []}>
            <div className="space-y-1">
              <SummaryRow label="Borrow capacity (LTV)" before={capacityTokens === undefined ? "unavailable" : formatToken(capacityTokens, decimals, symbol)} />
              <SummaryRow label="Pool liquidity" before={availableLiquidity === undefined ? "unavailable" : formatToken(availableLiquidity, decimals, symbol)} />
              {market?.borrowCap !== undefined && market.borrowCap > 0n && (
                <SummaryRow label="Borrow cap" before={`${market.borrowCap.toString()} ${symbol}`} />
              )}
            </div>
          </TxDetails>
        </TxForm>
      )}
    </TxDialog>
  );
}
