"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useLuminaWrite } from "@/hooks/chain";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { useIsolatedPosition } from "@/hooks/useUserIsolatedPositions";
import { useGuardStatus } from "@/hooks/useGuardStatus";
import { GUARD_BLOCKED_NOTE } from "@/lib/guard";
import { aprToApy, isolatedPreview } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { safeParseUnits } from "@/lib/format";
import { TxButton } from "@/components/common/TxButton";
import { GuardNotice } from "@/components/common/GuardNotice";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { AmountField, TxDialog, TxForm, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { IsolatedRiskSummary } from "@/components/tx/TxSummary";
import { TxDetails } from "@/components/tx/TxDetails";
import { IsolatedAfterState, previewCall } from "@/components/tx/AfterStates";
import { useIsolatedAccountRead } from "@/components/tx/reads";
import { formatToken } from "@/components/tx/format";
import { isolatedSides } from "@/components/tx/isolated";

interface Props {
  pair: `0x${string}`;
  onClose: () => void;
}

/**
 * Borrower-side collateral release — calls LightlendPair.removeCollateral(amount, receiver).
 * Reverts if the resulting position becomes insolvent. While in debt it is guard-gated like a
 * borrow (spec §3.2, r2 #6): blocked when the price guard blocks borrows OR the pair oracle is
 * unreadable / flags bad data, with a notice explaining which.
 */
export function IsolatedRemoveCollateralModal({ pair, onClose }: Props) {
  // Live pair and position data on every render (Codex #8).
  const info = useIsolatedPair(pair);
  const positionState = useIsolatedPosition(pair);
  const position = positionState.position;
  const positionKnown = positionState.status === "known";
  const guard = useGuardStatus();
  const collateralSymbol = info?.collateralSymbol ?? "";
  const collateralDecimals = info?.collateralDecimals ?? 18;
  const collateralAmount = position?.collateralAmount ?? 0n;
  const hasDebt = (position?.borrowedShares ?? 0n) > 0n;
  // Pair oracle bad data (price guard tripped): removal while in debt reverts.
  const oracleBadData = info?.oracleBadData;
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const ctx: TxErrorContext = { venue: "isolated", action: "removeCollateral", guardStatus: guard.key };

  const tx = useLuminaWrite();
  const read = useIsolatedAccountRead(pair, info?.dualOracle, address);
  const sides = isolatedSides(info);
  // Aligned with IsolatedBorrowModal: the guard OR the pair oracle blocks it while in debt.
  const blocked = hasDebt && (!guard.borrowAllowed || oracleBadData !== false);
  // The guard is OK but the pair oracle is unreadable or flags bad data: GuardNotice says nothing.
  const oracleOnlyBlock = blocked && guard.borrowAllowed;

  const parsed = amount ? (safeParseUnits(amount, collateralDecimals) ?? 0n) : 0n;
  const overMax = parsed > collateralAmount;

  useTxErrorToast(tx.error, "Remove collateral failed", ctx);
  useTxSuccessToast(tx.isSuccess, tx.hash, "Collateral removed", `Removed ${amount} ${collateralSymbol}`);

  const removeRequest = () => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "removeCollateral",
    args: [parsed, address],
  });

  const handleRemove = () => {
    if (!address) return;
    void tx.send(removeRequest());
  };

  const preview = parsed > 0n && sides ? isolatedPreview(read.state, { kind: "removeCollateral", amount: parsed }, sides) : null;

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess title={`Removed ${amount} ${collateralSymbol}`} hash={tx.hash} onClose={onClose}>
          {sides && <IsolatedAfterState read={read} sides={sides} receiptBlock={tx.receipt?.blockNumber} />}
        </TxSuccess>
      ) : (
        <TxForm title={`Remove ${collateralSymbol} Collateral`}>
          {hasDebt && <GuardNotice venue="isolated" />}
          {oracleOnlyBlock && (
            <p className="text-xs text-amber-400" data-testid="oracle-block-notice">
              {oracleBadData === undefined
                ? "The pair oracle cannot be read right now; removing collateral while in debt is disabled until it can."
                : "The pair oracle flags its price as bad data; removing collateral while in debt is disabled until it recovers."}{" "}
              {GUARD_BLOCKED_NOTE.isolated}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Withdraw {collateralSymbol} currently securing your debt. The pair will revert if the position becomes insolvent.
          </p>
          <AmountField
            label="Amount"
            aside={<>Posted: <span className="font-mono">{positionKnown ? formatToken(collateralAmount, collateralDecimals, collateralSymbol) : "—"}</span></>}
            value={amount}
            decimals={collateralDecimals}
            onChange={setAmount}
            onMax={() => setAmount(formatUnits(collateralAmount, collateralDecimals))}
            maxDisabled={!positionKnown || collateralAmount === 0n}
          >
            {overMax && <p className="text-xs text-destructive mt-1">Exceeds posted collateral</p>}
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
              invalid={overMax ? "more than your posted collateral" : null}
              stamp={read.stamp}
            />
          )}

          <TxButton
            onClick={handleRemove}
            isPending={tx.isPending}
            isSimulating={tx.isSimulating}
            isConfirming={tx.isConfirming}
            disabled={!address || !positionKnown || parsed === 0n || overMax || blocked}
          >
            {blocked ? "Removal blocked" : `Remove ${collateralSymbol}`}
          </TxButton>

          <TxDetails calls={parsed > 0n ? [previewCall(removeRequest())] : []} />
        </TxForm>
      )}
    </TxDialog>
  );
}
