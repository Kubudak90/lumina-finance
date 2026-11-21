"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useLuminaWrite } from "@/hooks/chain";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { useGuardStatus } from "@/hooks/useGuardStatus";
import { GUARD_BLOCKED_NOTE } from "@/lib/guard";
import { aprToApy, formatHealth, isolatedPreview } from "@/lib/risk";
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
import { isolatedPositionKnown, useIsolatedAccountRead } from "@/components/tx/reads";
import { formatToken } from "@/components/tx/format";
import { isolatedOracleGate, isolatedSides } from "@/components/tx/isolated";

interface Props {
  pair: `0x${string}`;
  onClose: () => void;
}

/**
 * Borrower-side collateral release — calls LightlendPair.removeCollateral(amount, receiver).
 * Reverts if the resulting position becomes insolvent. While in debt it is guard-gated like a
 * borrow (spec §3.2, r2 #6): blocked when the price guard blocks borrows OR the pair oracle is
 * unreadable / flags bad data, with a notice explaining which. The posted collateral, the debt,
 * MAX and the price block come from the modal's ONE stamped read, the same block as the summary;
 * the block also holds while the polled pair info flags bad data (U4 review r1 #3).
 */
export function IsolatedRemoveCollateralModal({ pair, onClose }: Props) {
  const info = useIsolatedPair(pair);
  const guard = useGuardStatus();
  const collateralSymbol = info?.collateralSymbol ?? "";
  const collateralDecimals = info?.collateralDecimals ?? 18;
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const ctx: TxErrorContext = { venue: "isolated", action: "removeCollateral", guardStatus: guard.key };

  const tx = useLuminaWrite();
  const read = useIsolatedAccountRead(pair, info?.dualOracle, address);
  const sides = isolatedSides(info);
  // The position from the modal's read (unknown while it loads or if it failed: removal waits).
  const positionKnown = isolatedPositionKnown(read);
  const collateralAmount = read.state.collateral ?? 0n;
  const hasDebt = (read.state.borrowedShares ?? 0n) > 0n;
  // Pair oracle bad data (price guard tripped): removal while in debt reverts.
  const oracle = isolatedOracleGate(info?.oracleBadData, read);
  // Aligned with IsolatedBorrowModal: the guard OR the pair oracle blocks it while in debt.
  const blocked = hasDebt && (!guard.borrowAllowed || oracle !== "ok");
  // The guard is OK but the pair oracle is unreadable or flags bad data: GuardNotice says nothing.
  const oracleOnlyBlock = hasDebt && guard.borrowAllowed && (oracle === "bad" || oracle === "unreadable");
  /** Blocked for a reason to explain (not just while the modal's read loads). */
  const blockShown = hasDebt && (!guard.borrowAllowed || oracle === "bad" || oracle === "unreadable");

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
  // The summary (same read) says this removal leaves the position liquidatable: the pair would
  // revert it (Insolvent), so it is not offered (U4 review r1 #3: no send the summary warns against).
  const afterLiquidatable =
    preview !== null && formatHealth({ kind: "ltv", ltv: preview.after.ltv, maxLTV: preview.after.maxLTV }).status === "liquidatable";

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
              {oracle === "unreadable"
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
            {!overMax && afterLiquidatable && (
              <p className="text-xs text-destructive mt-1" data-testid="remove-insolvent">
                More than the position can release: it would be above the pair&apos;s max LTV
              </p>
            )}
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
            disabled={!address || !positionKnown || parsed === 0n || overMax || afterLiquidatable || blocked}
          >
            {blockShown ? "Removal blocked" : `Remove ${collateralSymbol}`}
          </TxButton>

          <TxDetails calls={parsed > 0n ? [previewCall(removeRequest())] : []} />
        </TxForm>
      )}
    </TxDialog>
  );
}
