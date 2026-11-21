"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useLuminaWrite } from "@/hooks/chain";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { coreApy, corePreview } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { TxButton } from "@/components/common/TxButton";
import { TxDialog, TxForm, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { CoreRiskSummary } from "@/components/tx/TxSummary";
import { TxDetails } from "@/components/tx/TxDetails";
import { CoreAfterState, previewCall } from "@/components/tx/AfterStates";
import { useCoreRiskInputs } from "@/components/tx/reads";

interface EnableCollateralModalProps {
  asset: `0x${string}`;
  symbol: string;
  currentlyEnabled: boolean;
  onClose: () => void;
}

const CTX: TxErrorContext = { venue: "core", action: "collateral" };

export function EnableCollateralModal({ asset, symbol, currentlyEnabled, onClose }: EnableCollateralModalProps) {
  const { address } = useAccount();
  const tx = useLuminaWrite();
  const core = useCoreRiskInputs();
  const pool = LUMINA.contracts.pool;
  // The direction sent, latched at submit: the post-receipt read flips `currentlyEnabled`, and the
  // success screen must keep describing what was done (spec §3.2, r2 #3; like RepayModal's
  // submittedFull).
  const [submitted, setSubmitted] = useState<boolean | null>(null);

  // aToken balance — Aave V3 reverts (error 43) on enable with zero balance.
  const balance = core.positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase())?.supplied ?? 0n;
  const hasSupply = balance > 0n;

  const newValue = !currentlyEnabled;
  const done = submitted ?? newValue;
  const actionLabel = newValue ? "Enable" : "Disable";
  const blockedNoSupply = newValue && !hasSupply;

  useTxErrorToast(tx.error, `${done ? "Enable" : "Disable"} collateral failed`, CTX);
  useTxSuccessToast(tx.isSuccess, tx.hash, `Collateral ${done ? "enabled" : "disabled"}`);

  const request = () => ({
    address: pool ?? ("" as `0x${string}`),
    abi: POOL_ABI,
    functionName: "setUserUseReserveAsCollateral",
    args: [asset, newValue],
  });

  const handleToggle = () => {
    if (!address || !pool || blockedNoSupply) return;
    setSubmitted(newValue);
    void tx.send(request());
  };

  // Shown on open: the action is the whole balance, there is no amount to enter.
  const preview = corePreview(core.snapshot, { kind: "setCollateral", asset, enabled: newValue });

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess
          title={`Collateral ${done ? "Enabled" : "Disabled"}`}
          message={`You ${done ? "enabled" : "disabled"} ${symbol} as collateral`}
          hash={tx.hash}
          onClose={onClose}
        >
          <CoreAfterState core={core} receiptBlock={tx.receipt?.blockNumber} />
        </TxSuccess>
      ) : (
        <TxForm title={`${actionLabel} ${symbol} as Collateral`}>
          <p className="text-sm text-muted-foreground">
            {newValue
              ? `Enabling as collateral allows you to borrow against your supplied ${symbol}.`
              : `Disabling collateral means your ${symbol} will no longer back your borrows. This may lower your health factor.`}
          </p>

          {blockedNoSupply && (
            <div className="technical-border bg-warning-surface-subtle border-warning-border p-3 space-y-2">
              <p className="text-sm text-warning-strong font-medium">You have no {symbol} supplied</p>
              <p className="text-xs text-muted-foreground">
                Aave V3 requires an aToken balance before an asset can be used as collateral. Supply {symbol} first, after which it
                will be enabled as collateral automatically.
              </p>
              <Link
                href={`/markets/${symbol.toLowerCase()}`}
                onClick={onClose}
                className="inline-block mt-1 text-xs text-accent hover:underline font-mono uppercase tracking-wider"
              >
                Go to {symbol} Market &rarr;
              </Link>
            </div>
          )}

          {!blockedNoSupply && (
            <CoreRiskSummary
              preview={preview}
              apy={coreApy(core.getMarket(asset)?.supplyRate)}
              apyLabel="Supply APY"
              stamp={core.stamp}
            />
          )}

          <TxButton
            onClick={handleToggle}
            isPending={tx.isPending}
            isSimulating={tx.isSimulating}
            isConfirming={tx.isConfirming}
            disabled={!address || blockedNoSupply}
          >
            {blockedNoSupply ? `Supply ${symbol} first` : `${actionLabel} Collateral`}
          </TxButton>

          <TxDetails calls={blockedNoSupply ? [] : [previewCall(request())]} />
        </TxForm>
      )}
    </TxDialog>
  );
}
