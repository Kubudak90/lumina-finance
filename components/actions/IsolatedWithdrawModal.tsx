"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { bigintAt, resultAt, useLuminaReadContract, useLuminaReader, useLuminaWrite } from "@/hooks/chain";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { explorerToastAction } from "@/lib/explorer";
import { TxButton } from "@/components/common/TxButton";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isValidDecimalInput, safeParseUnits } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";

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
  const { address } = useAccount();
  const read = useLuminaReader();

  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

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

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Withdraw failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Withdraw successful", { action: explorerToastAction(hash, "View") });
    }
  }, [isSuccess, hash]);

  const handleWithdraw = async () => {
    if (!address) return;
    setNotice(null);
    if (!withdrawAll) {
      if (parsed === 0n) return;
      await send({ address: pair, abi: ISOLATED_PAIR_ABI, functionName: "withdraw", args: [parsed, address, address] });
      return;
    }
    try {
      // The whole share balance, and what the pair's liquidity lets out right now.
      const r = await read([
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
      await send({ address: pair, abi: ISOLATED_PAIR_ABI, functionName: "redeem", args: [shares, address, address] });
    } catch (err) {
      setNotice(`Could not read your share balance (${(err as Error).message}); nothing was sent.`);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Withdrew {withdrawAll ? "all your" : amount} {assetSymbol}</DialogTitle>
            </DialogHeader>
            <Button variant="link" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Withdraw {assetSymbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Burn lender shares and receive {assetSymbol} back from the isolated pair.
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Available:{" "}
                    <span className="font-mono" data-testid="withdraw-available">
                      {maxRaw === undefined ? "—" : Number(maxFmt).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    </span>{" "}
                    {assetSymbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    aria-label="Amount"
                    type="number"
                    value={withdrawAll ? maxFmt : amount}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || (isValidDecimalInput(v, assetDecimals) && Number(v) >= 0)) {
                        setWithdrawAll(false);
                        setAmount(v);
                      }
                    }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    disabled={maxRaw === undefined || maxRaw === 0n}
                    onClick={() => setWithdrawAll(true)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {withdrawAll && <p className="text-xs text-accent mt-1">Withdraw all: redeems your whole share balance at execution.</p>}
                {overMax && <p className="text-xs text-destructive mt-1">Exceeds available balance</p>}
                {notice && <p className="text-xs text-amber-400 mt-1">{notice}</p>}
              </div>
              <TxButton
                onClick={() => void handleWithdraw()}
                isPending={isPending}
                isSimulating={isSimulating}
                isConfirming={isConfirming}
                disabled={!address || !info || (!withdrawAll && (parsed === 0n || overMax))}
              >
                Withdraw {assetSymbol}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
