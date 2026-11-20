"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { safeParseUnits, isValidDecimalInput, formatHealthFactor } from "@/lib/format";
import { explorerToastAction } from "@/lib/explorer";
import { exactApproval } from "@/lib/approvals";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { TxButton } from "@/components/common/TxButton";
import { TxPreviewCard } from "@/components/common/TxPreview";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { ExplorerLink } from "@/components/common/ExplorerLink";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SupplyModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function SupplyModal({ asset, symbol, decimals, onClose }: SupplyModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating, preview } = useLuminaWrite();
  const wallet = useWalletBalance(asset);
  const { healthFactor } = useHealthFactor();

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;
  const balance = wallet.value;
  const balanceFormatted = balance === undefined ? "" : formatUnits(balance, decimals);

  const sendSupply = async (value: bigint) => {
    if (!address || !pool) return;
    // Re-validate against the chain right before the wallet prompt.
    const walletNow = await wallet.fetchNow();
    if (walletNow === undefined || walletNow < value) {
      toast.error("Supply not sent", { description: "Your wallet balance no longer covers the amount." });
      return;
    }
    await send({ address: pool, abi: POOL_ABI, functionName: "supply", args: [asset, value, address, 0] });
  };

  const flow = useApprovalFlow<{ amount: bigint }>({
    token: asset,
    spender: pool,
    paramsKey: amount,
    onProceed: ({ amount: value }) => sendSupply(value),
  });

  const prevErrorRef = useRef<Error | null>(null);
  const prevApprovalErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Supply failed", { description: parseErrorMessage(error) });
    }
  }, [error]);
  useEffect(() => {
    if (flow.error && flow.error !== prevApprovalErrorRef.current) {
      prevApprovalErrorRef.current = flow.error;
      toast.error("Approval failed", { description: parseErrorMessage(flow.error) });
    }
  }, [flow.error]);
  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Supply successful", { description: "Transaction confirmed", action: explorerToastAction(hash) });
    }
  }, [isSuccess, hash]);

  const needsApproval = parsedAmount > 0n && flow.needsApproval(parsedAmount);

  const handleSupply = () => {
    if (!address || !pool || parsedAmount === 0n) return;
    if (needsApproval) {
      // Supply approves exactly the amount supplied (FE-04).
      void flow.start({ amount: parsedAmount }, exactApproval(parsedAmount));
      return;
    }
    void sendSupply(parsedAmount);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Supply Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground">You supplied {amount} {symbol}</p>
            <PostTxAllowance refetch={flow.refetchAllowance} symbol={symbol} decimals={decimals} spenderLabel="Pool" />
            {hash && <ExplorerLink hash={hash} />}
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Supply {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Wallet: <span className="font-mono">{balance === undefined ? "—" : Number(balanceFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    aria-label="Amount"
                    type="number"
                    value={amount}
                    onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, decimals) && Number(v) >= 0)) setAmount(v); }}
                    placeholder="0.00"
                    min="0"
                    step="any"
                    className="h-12 text-lg bg-transparent border-border font-mono pr-16"
                  />
                  <button
                    type="button"
                    disabled={balance === undefined}
                    onClick={() => setAmount(balanceFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {balance !== undefined && parsedAmount > balance && (
                  <p className="text-xs text-destructive mt-1">Insufficient balance</p>
                )}
                {flow.cancelReason && <p className="text-xs text-amber-400 mt-1">Approval flow cancelled: {flow.cancelReason}.</p>}
              </div>

              <AllowanceNote
                symbol={symbol}
                decimals={decimals}
                spenderLabel="Pool"
                allowance={flow.allowance}
                approveAmount={needsApproval ? parsedAmount : undefined}
              />

              <TxButton
                onClick={handleSupply}
                isPending={isPending || flow.isPending}
                isSimulating={isSimulating || flow.isSimulating}
                isConfirming={isConfirming || flow.isConfirming || flow.awaitingApproval}
                disabled={!address || parsedAmount === 0n || balance === undefined || parsedAmount > balance}
              >
                {needsApproval ? `Approve ${symbol}` : `Supply ${symbol}`}
              </TxButton>
              <TxPreviewCard preview={preview} />

              {healthFactor !== undefined && (
                <div className="technical-border bg-background p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <span className="font-mono font-medium">{formatHealthFactor(healthFactor)}</span>
                  </div>
                  <p className="text-xs text-emerald-400">Supply increases your health factor</p>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
