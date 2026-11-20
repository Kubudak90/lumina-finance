"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useIsolatedPair } from "@/hooks/useIsolatedPairs";
import { explorerToastAction } from "@/lib/explorer";
import { exactApproval } from "@/lib/approvals";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { ISOLATED_PAIR_ABI } from "@/lib/abis";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { isValidDecimalInput, safeParseUnits } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";

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
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsed = amount ? (safeParseUnits(amount, collateralDecimals) ?? 0n) : 0n;
  const balanceRaw = wallet.value;
  const balanceFormatted = balanceRaw === undefined ? "" : formatUnits(balanceRaw, collateralDecimals);

  const sendAdd = async ({ amount: value }: { amount: bigint }) => {
    if (!address) return;
    const walletNow = await wallet.fetchNow();
    if (walletNow === undefined || walletNow < value) {
      toast.error("Not sent", { description: "Your wallet balance no longer covers the amount." });
      return;
    }
    await send({ address: pair, abi: ISOLATED_PAIR_ABI, functionName: "addCollateral", args: [value, address] });
  };

  const flow = useApprovalFlow<{ amount: bigint }>({
    token: collateral ?? pair,
    spender: collateral ? pair : null,
    paramsKey: amount,
    onProceed: sendAdd,
  });
  const needsApproval = parsed > 0n && flow.needsApproval(parsed);

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    const e = error ?? flow.error;
    if (e && e !== prevError.current) {
      prevError.current = e;
      toast.error("Add collateral failed", { description: parseErrorMessage(e) });
    }
  }, [error, flow.error]);
  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Collateral added", { description: `Added ${amount} ${collateralSymbol}`, action: explorerToastAction(hash, "View") });
    }
  }, [isSuccess, hash, amount, collateralSymbol]);

  const handleAdd = () => {
    if (!address || parsed === 0n) return;
    if (needsApproval) {
      // Add-collateral approves exactly the amount added (FE-04).
      void flow.start({ amount: parsed }, exactApproval(parsed));
      return;
    }
    void sendAdd({ amount: parsed });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Added {amount} {collateralSymbol}</DialogTitle>
            </DialogHeader>
            <PostTxAllowance refetch={flow.refetchAllowance} symbol={collateralSymbol} decimals={collateralDecimals} spenderLabel="pair" />
            <Button variant="link" onClick={onClose} className="mt-2">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add {collateralSymbol} Collateral</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Post more {collateralSymbol} to lower your LTV in this pair. Allowed even while borrowing is blocked.
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{balanceRaw === undefined ? "—" : Number(balanceFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {collateralSymbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    aria-label="Amount"
                    type="number"
                    value={amount}
                    onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, collateralDecimals) && Number(v) >= 0)) setAmount(v); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    disabled={balanceRaw === undefined}
                    onClick={() => setAmount(balanceFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {balanceRaw !== undefined && parsed > balanceRaw && <p className="text-xs text-destructive mt-1">Insufficient balance</p>}
                {flow.cancelReason && <p className="text-xs text-amber-400 mt-1">Approval flow cancelled: {flow.cancelReason}.</p>}
              </div>
              <AllowanceNote
                symbol={collateralSymbol}
                decimals={collateralDecimals}
                spenderLabel="pair"
                allowance={flow.allowance}
                approveAmount={needsApproval ? parsed : undefined}
              />
              <TxButton
                onClick={handleAdd}
                isPending={isPending || flow.isPending}
                isSimulating={isSimulating || flow.isSimulating}
                isConfirming={isConfirming || flow.isConfirming || flow.awaitingApproval}
                disabled={!address || !info || parsed === 0n || balanceRaw === undefined || parsed > balanceRaw}
              >
                {needsApproval ? `Approve ${collateralSymbol}` : `Add ${collateralSymbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
