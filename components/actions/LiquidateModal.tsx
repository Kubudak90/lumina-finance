"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { safeParseUnits, isValidDecimalInput } from "@/lib/format";
import { explorerToastAction } from "@/lib/explorer";
import { exactApproval } from "@/lib/approvals";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { ExplorerLink } from "@/components/common/ExplorerLink";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface LiquidateModalProps {
  borrower: `0x${string}`;
  debtAsset: `0x${string}`;
  debtSymbol: string;
  collateralAsset: `0x${string}`;
  /** Largest debtToCover the pool will use (close factor by HF + collateral cap), base units. */
  maxDebt: bigint;
  /** Close factor applied, in bps (5000 or 10000). */
  closeFactorBps: bigint;
  collateralLimited: boolean;
  debtDecimals: number;
  onClose: () => void;
}

type LiquidateParams = { amount: bigint };

export function LiquidateModal({
  borrower,
  debtAsset,
  debtSymbol,
  collateralAsset,
  maxDebt,
  closeFactorBps,
  collateralLimited,
  debtDecimals,
  onClose,
}: LiquidateModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const wallet = useWalletBalance(debtAsset);
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();

  const parsedAmount = amount ? (safeParseUnits(amount, debtDecimals) ?? 0n) : 0n;
  const exceedsMax = parsedAmount > 0n && parsedAmount > maxDebt;
  const walletBalance = wallet.value;
  const insufficientBalance = walletBalance !== undefined && parsedAmount > walletBalance;

  const sendLiquidation = async ({ amount: value }: LiquidateParams) => {
    if (!pool) return;
    const walletNow = await wallet.fetchNow();
    if (walletNow === undefined || walletNow < value) {
      toast.error("Liquidation not sent", { description: "Your wallet balance no longer covers the amount." });
      return;
    }
    // Aave V3: liquidationCall(collateralAsset, debtAsset, user, debtToCover, receiveAToken)
    await send({
      address: pool,
      abi: POOL_ABI,
      functionName: "liquidationCall",
      args: [collateralAsset, debtAsset, borrower, value, false],
    });
  };

  const flow = useApprovalFlow<LiquidateParams>({
    token: debtAsset,
    spender: pool,
    paramsKey: amount,
    onProceed: sendLiquidation,
  });
  const needsApproval = parsedAmount > 0n && flow.needsApproval(parsedAmount);

  const prevErrorRef = useRef<Error | null>(null);
  const prevApprovalErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Liquidation failed", { description: parseErrorMessage(error) });
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
      toast.success("Liquidation successful", { description: "Transaction confirmed", action: explorerToastAction(hash) });
    }
  }, [isSuccess, hash]);

  const handleLiquidate = () => {
    if (!pool || parsedAmount === 0n) return;
    if (needsApproval) {
      // Exact, finite approval on purpose (review decision #4b): liquidationCall pulls at most
      // `debtToCover` (it lowers, never raises, the amount to the close-factor / collateral limit),
      // so accrual cannot make it pull more than approved. The repay buffer (R1-5 / R2-1) is for
      // repays, whose pulled amount can grow after the approval.
      void flow.start({ amount: parsedAmount }, exactApproval(parsedAmount));
      return;
    }
    void sendLiquidation({ amount: parsedAmount });
  };

  const maxFormatted = formatUnits(maxDebt, debtDecimals);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Liquidation Successful</DialogTitle>
            </DialogHeader>
            <PostTxAllowance refetch={flow.refetchAllowance} symbol={debtSymbol} decimals={debtDecimals} spenderLabel="Pool" />
            {hash && <ExplorerLink hash={hash} />}
            <Button variant="link" onClick={onClose} className="mt-4">Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Liquidate Position</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Max repayable: {Number(maxFormatted).toLocaleString("en-US", { maximumFractionDigits: 6 })} {debtSymbol} (
                {closeFactorBps === 10_000n ? "100% close factor, HF ≤ 0.95" : "50% close factor"}
                {collateralLimited ? ", limited by the collateral at the liquidation bonus" : ""})
              </p>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Repay Amount</label>
                  <button type="button" className="text-xs text-accent" onClick={() => setAmount(maxFormatted)}>
                    MAX
                  </button>
                </div>
                <Input
                  aria-label="Amount"
                  type="number"
                  value={amount}
                  onChange={(e) => { const v = e.target.value; if (v === "" || (isValidDecimalInput(v, debtDecimals) && Number(v) >= 0)) setAmount(v); }}
                  placeholder="0.00"
                  className="h-12 text-lg bg-transparent border-border font-mono"
                />
                {exceedsMax && <p className="text-xs text-destructive mt-1">Amount exceeds the max liquidatable debt</p>}
                {insufficientBalance && !exceedsMax && <p className="text-xs text-destructive mt-1">Insufficient balance</p>}
                {flow.cancelReason && <p className="text-xs text-amber-400 mt-1">Approval flow cancelled: {flow.cancelReason}.</p>}
              </div>
              <AllowanceNote
                symbol={debtSymbol}
                decimals={debtDecimals}
                spenderLabel="Pool"
                allowance={flow.allowance}
                approveAmount={needsApproval ? parsedAmount : undefined}
              />
              <TxButton
                onClick={handleLiquidate}
                isPending={isPending || flow.isPending}
                isSimulating={isSimulating || flow.isSimulating}
                isConfirming={isConfirming || flow.isConfirming || flow.awaitingApproval}
                disabled={!address || parsedAmount === 0n || exceedsMax || walletBalance === undefined || insufficientBalance}
              >
                {needsApproval ? `Approve ${debtSymbol}` : "Execute Liquidation"}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
