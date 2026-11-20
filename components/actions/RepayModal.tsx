"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { safeParseUnits, isValidDecimalInput, formatHealthFactor } from "@/lib/format";
import { explorerToastAction } from "@/lib/explorer";
import { planCoreRepay, type CoreRepayPlan } from "@/lib/approvals";
import { QUERY } from "@/lib/queryPolicy";
import { POOL_ABI, ERC20_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { useUserPosition } from "@/hooks/useUserPosition";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { ExplorerLink } from "@/components/common/ExplorerLink";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface RepayModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

/**
 * Core (Aave) repay. Every repay approves ceil(value × 1.001) + 1 (spec §3.3, R1-5); a full repay
 * sends Aave's entire-debt sentinel so no dust debt is left (FE-09).
 */
export function RepayModal({ asset, symbol, decimals, onClose }: RepayModalProps) {
  const [amount, setAmount] = useState("");
  const [pendingRepayAfterApproval, setPendingRepayAfterApproval] = useState(false);
  const planRef = useRef<CoreRepayPlan | null>(null);
  const [submittedFull, setSubmittedFull] = useState(false);
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const approval = useTokenApproval(asset, pool, address);
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();
  const { positions, accountData, stamp } = useUserPosition();

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;

  const walletBalanceResult = useLuminaReadContract({
    address: asset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, ...QUERY.user },
  });
  const wallet = (walletBalanceResult.data as bigint | undefined) ?? 0n;
  const walletFormatted = formatUnits(wallet, decimals);

  const debt = positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase())?.borrowed ?? 0n;
  const debtFormatted = formatUnits(debt, decimals);

  // MAX = min(wallet, debt). With the full debt in hand, MAX means "repay everything".
  const maxRepay = wallet < debt ? wallet : debt;
  const maxRepayFormatted = formatUnits(maxRepay, decimals);

  const plan = parsedAmount > 0n && debt > 0n ? planCoreRepay({ input: parsedAmount, debt }) : null;
  // A partial repay pulls exactly `amount`; a full repay pulls the debt as of the repay block,
  // which only the buffered approval covers.
  const required = plan ? (plan.full ? plan.approve : plan.amountArg) : 0n;
  const approvalNeeded = plan !== null && approval.needsApproval(required);
  const healthFactor = accountData?.healthFactor;

  const prevErrorRef = useRef<Error | null>(null);
  const prevApprovalErrorRef = useRef<Error | null>(null);

  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Repayment failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (approval.error && approval.error !== prevApprovalErrorRef.current) {
      prevApprovalErrorRef.current = approval.error;
      toast.error("Approval failed", { description: parseErrorMessage(approval.error) });
    }
  }, [approval.error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Repayment successful", { description: "Transaction confirmed", action: explorerToastAction(hash) });
    }
  }, [isSuccess, hash]);

  useEffect(() => {
    setPendingRepayAfterApproval(false);
  }, [amount]);

  useEffect(() => {
    if (approval.isSuccess && pendingRepayAfterApproval && planRef.current) {
      setPendingRepayAfterApproval(false);
      if (!address || !pool) return;
      void send({
        address: pool,
        abi: POOL_ABI,
        functionName: "repay",
        args: [asset, planRef.current.amountArg, 2n, address],
      });
    }
  }, [approval.isSuccess, pendingRepayAfterApproval, address, asset, pool, send]);

  const handleRepay = () => {
    if (!address || !pool || !plan) return;
    planRef.current = plan;
    setSubmittedFull(plan.full);
    if (approvalNeeded) {
      approval.approve(plan.approve);
      setPendingRepayAfterApproval(true);
      return;
    }
    void send({
      address: pool,
      abi: POOL_ABI,
      functionName: "repay",
      args: [asset, plan.amountArg, 2n, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Repayment Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">
              You repaid {submittedFull ? "your full" : amount} {symbol}{submittedFull ? " debt" : ""}
            </p>
            {hash && <ExplorerLink hash={hash} />}
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Repay {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="technical-border bg-background p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{symbol} Debt</span>
                  <span className="font-mono">{Number(debtFormatted).toLocaleString("en-US", { maximumFractionDigits: 6 })} {symbol}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Wallet</span>
                  <span className="font-mono">{Number(walletFormatted).toLocaleString("en-US", { maximumFractionDigits: 6 })} {symbol}</span>
                </div>
                <FreshnessStamp stamp={stamp} label="Debt" />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Max: <span className="font-mono">{Number(maxRepayFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
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
                    onClick={() => setAmount(maxRepayFormatted)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {parsedAmount > wallet && (
                  <p className="text-xs text-destructive mt-1">Insufficient wallet balance</p>
                )}
                {plan?.full && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Full repay: the pool takes your debt as of the repay block (interest accrued until then is covered).
                  </p>
                )}
              </div>

              <AllowanceNote
                symbol={symbol}
                decimals={decimals}
                spenderLabel="Pool"
                allowance={approval.allowance}
                approveAmount={plan && approvalNeeded ? plan.approve : undefined}
                expectedPull={plan?.assetValue}
                buffered
              />

              {healthFactor !== undefined && (
                <div className="technical-border bg-background p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <span className="font-mono font-medium">{formatHealthFactor(healthFactor)}</span>
                  </div>
                  <p className="text-xs text-emerald-400">Repaying improves your health factor</p>
                </div>
              )}

              <TxButton
                onClick={handleRepay}
                isPending={isPending || approval.isPending}
                isSimulating={isSimulating || approval.isSimulating}
                isConfirming={isConfirming || approval.isConfirming}
                disabled={!address || !plan || parsedAmount > wallet || (plan.full && wallet < debt)}
              >
                {approvalNeeded ? `Approve ${symbol}` : `Repay ${symbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
