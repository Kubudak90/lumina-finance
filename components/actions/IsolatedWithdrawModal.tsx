"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { bigintAt, resultAt, useLuminaReadContract, useLuminaReader, useLuminaWrite } from "@/hooks/chain";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { aprToApy } from "@/lib/risk";
import type { TxErrorContext } from "@/lib/txErrors";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { safeParseUnits } from "@/lib/format";
import { formatUnits } from "viem";
import { TxButton } from "@/components/common/TxButton";
import { AmountField, TxDialog, TxForm, TxNotice, TxSuccess, useTxErrorToast, useTxSuccessToast } from "@/components/tx/TxShell";
import { LenderSummary } from "@/components/tx/TxSummary";
import { TxDetails } from "@/components/tx/TxDetails";
import { LenderAfterState, previewCall } from "@/components/tx/AfterStates";
import { useIsolatedAccountRead } from "@/components/tx/reads";
import { formatAmount } from "@/components/tx/format";

const CTX: TxErrorContext = { venue: "isolated", action: "withdraw" };

/**
 * Lender-side withdraw. A typed amount calls withdraw(amount, receiver, owner). MAX sets a
 * "withdraw all" intent that redeems the lender's whole share balance with
 * redeem(shares, receiver, owner), read from the chain when sending, so interest accrued after the
 * click is withdrawn too and no dust shares remain (Gemini r2 m4). No token approval is needed.
 */
export function IsolatedWithdrawModal({ pair, onClose }: { pair: `0x${string}`; onClose: () => void }) {
  const info = useIsolatedPair(pair);
  const assetSymbol = info?.assetSymbol ?? "";
  const assetDecimals = info?.assetDecimals ?? 18;
  const [amount, setAmount] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // MAX reads the share balance before sending: one send at a time, bound to the account and the
  // intent it started with (review U2 r1 #1).
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const { address } = useAccount();
  const liveRef = useRef({ address, withdrawAll });
  useEffect(() => {
    liveRef.current = { address, withdrawAll };
  });
  const readNow = useLuminaReader();
  const tx = useLuminaWrite();
  const read = useIsolatedAccountRead(pair, info?.dualOracle, address);

  const max = useLuminaReadContract({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "maxWithdraw",
    args: address ? [address] : undefined,
    query: { enabled: !!address, ...QUERY.user },
  });
  // Unavailable while loading or failed: shown as "—", never 0.
  const maxRaw = max.data as bigint | undefined;
  const maxFmt = maxRaw === undefined ? "" : formatUnits(maxRaw, assetDecimals);
  const parsed = amount ? (safeParseUnits(amount, assetDecimals) ?? 0n) : 0n;
  const overMax = !withdrawAll && maxRaw !== undefined && parsed > maxRaw;

  useTxErrorToast(tx.error, "Withdraw failed", CTX);
  useTxSuccessToast(tx.isSuccess, tx.hash, "Withdraw successful");

  const withdrawRequest = (value: bigint) => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "withdraw",
    args: [value, address, address],
  });
  const redeemRequest = (shares: bigint | string) => ({
    address: pair,
    abi: ISOLATED_PAIR_ABI,
    functionName: "redeem",
    args: [shares, address, address],
  });

  const handleWithdraw = async () => {
    if (!address) return;
    setNotice(null);
    if (!withdrawAll) {
      if (parsed === 0n) return;
      await tx.send(withdrawRequest(parsed));
      return;
    }
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      // The whole share balance, and what the pair's liquidity lets out right now.
      const r = await readNow([
        // getUserSnapshot(...)[0] = the lender's share (hToken) balance.
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "getUserSnapshot", args: [address] },
        { address: pair, abi: ISOLATED_PAIR_ABI, functionName: "maxRedeem", args: [address] },
      ]);
      const snapshot = resultAt<readonly bigint[]>(r, 0);
      const shares = snapshot?.[0];
      const redeemable = bigintAt(r, 1);
      if (shares === undefined || redeemable === undefined) throw new Error("share balance unavailable");
      if (shares === 0n) {
        setNotice("Nothing to withdraw.");
        return;
      }
      if (redeemable < shares) {
        setNotice("The pair's free liquidity does not cover your whole balance right now; withdraw an amount instead.");
        return;
      }
      const live = liveRef.current;
      if (!live.withdrawAll || live.address?.toLowerCase() !== address.toLowerCase()) {
        setNotice("The account or the amount changed while your balance was read; nothing was sent.");
        return;
      }
      await tx.send(redeemRequest(shares));
    } catch (err) {
      setNotice(`Could not read your share balance (${(err as Error).message}); nothing was sent.`);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  };

  const lentAfter = read.lent === undefined ? undefined : withdrawAll ? 0n : read.lent > parsed ? read.lent - parsed : 0n;
  const overLent = !withdrawAll && read.lent !== undefined && parsed > read.lent;
  const showSummary = withdrawAll || parsed > 0n;

  return (
    <TxDialog onClose={onClose}>
      {tx.isSuccess ? (
        <TxSuccess title={`Withdrew ${withdrawAll ? "all your" : amount} ${assetSymbol}`} hash={tx.hash} onClose={onClose}>
          <LenderAfterState read={read} symbol={assetSymbol} decimals={assetDecimals} receiptBlock={tx.receipt?.blockNumber} />
        </TxSuccess>
      ) : (
        <TxForm title={`Withdraw ${assetSymbol}`}>
          <p className="text-sm text-muted-foreground">Burn lender shares and receive {assetSymbol} back from the isolated pair.</p>
          <AmountField
            label="Amount"
            aside={
              <>
                Available:{" "}
                <span className="font-mono" data-testid="withdraw-available">
                  {maxRaw === undefined ? "—" : formatAmount(maxRaw, assetDecimals)}
                </span>{" "}
                {assetSymbol}
              </>
            }
            value={withdrawAll ? maxFmt : amount}
            decimals={assetDecimals}
            onChange={(v) => {
              setWithdrawAll(false);
              setAmount(v);
            }}
            onMax={() => setWithdrawAll(true)}
            maxDisabled={maxRaw === undefined || maxRaw === 0n}
          >
            {withdrawAll && <p className="text-xs text-accent mt-1">Withdraw all: redeems your whole share balance at execution.</p>}
            {overMax && <p className="text-xs text-destructive mt-1">Exceeds available balance</p>}
            {notice && <TxNotice>{notice}</TxNotice>}
          </AmountField>

          {showSummary && (
            <LenderSummary
              before={read.lent}
              after={lentAfter}
              symbol={assetSymbol}
              decimals={assetDecimals}
              apy={info?.lendApr === undefined ? undefined : aprToApy(info.lendApr)}
              invalid={overMax || overLent ? "more than you can withdraw now" : null}
              clamped={overLent}
            />
          )}

          <TxButton
            onClick={() => void handleWithdraw()}
            isPending={tx.isPending}
            isSimulating={tx.isSimulating}
            isConfirming={tx.isConfirming}
            isChecking={checking}
            disabled={!address || !info || (!withdrawAll && (parsed === 0n || overMax))}
          >
            Withdraw {assetSymbol}
          </TxButton>

          <TxDetails
            calls={
              withdrawAll
                ? [previewCall(redeemRequest(read.assetShares ?? "your whole share balance, read when sending"))]
                : parsed > 0n
                  ? [previewCall(withdrawRequest(parsed))]
                  : []
            }
          />
        </TxForm>
      )}
    </TxDialog>
  );
}
