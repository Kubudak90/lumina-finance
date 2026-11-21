"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { safeParseUnits, isValidDecimalInput, formatHealthFactor } from "@/lib/format";
import { explorerToastAction } from "@/lib/explorer";
import { coreFullRepayFunding, hasExecutionHeadroom, planCoreRepay } from "@/lib/approvals";
import { QUERY } from "@/lib/queryPolicy";
import { POOL_ABI, VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";
import { LUMINA, getCoreMarketByAsset } from "@/lib/deployments";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { TxButton } from "@/components/common/TxButton";
import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { ExplorerLink } from "@/components/common/ExplorerLink";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface RepayModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

type RepayParams = { repayAll: boolean; input: bigint };

const fmt = (v: bigint, d: number, max = 6) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: max });

/**
 * Core (Aave) repay.
 * - MAX sets a "repay all" intent, kept apart from the amount text until the user edits it: the
 *   repay then sends Aave's entire-debt sentinel and approves the buffered CURRENT debt (#5).
 * - Every repay's allowance threshold is the buffered amount (R1-5, Codex #4a).
 * - The wallet must hold the execution headroom over the current debt (ceil(debt × 1.0005) + 1)
 *   for a full repay; otherwise a partial repay of the wallet balance is offered (#6). After the
 *   approval confirms, wallet and allowance are re-read and need only that headroom over the
 *   accrued debt, never a fresh 10 bps buffer (Gemini r2 C1).
 */
export function RepayModal({ asset, symbol, decimals, onClose }: RepayModalProps) {
  const [amount, setAmount] = useState("");
  const [repayAll, setRepayAll] = useState(false);
  const [submittedFull, setSubmittedFull] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const debtToken = getCoreMarketByAsset(asset)?.variableDebtToken ?? undefined;
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();
  const wallet = useWalletBalance(asset);
  const { healthFactor } = useHealthFactor();

  // The debt the pool will see, polled; re-read right before sending.
  const debtRead = useLuminaReadContract({
    address: debtToken,
    abi: VARIABLE_DEBT_TOKEN_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!debtToken, ...QUERY.user },
  });
  const debt = debtRead.data as bigint | undefined;
  const walletValue = wallet.value;

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;
  const shownAmount = repayAll && debt !== undefined ? formatUnits(debt, decimals) : amount;

  const planFor = (params: RepayParams, debtNow: bigint) =>
    (params.repayAll ? debtNow > 0n : params.input > 0n) ? planCoreRepay({ ...params, debt: debtNow }) : null;
  const plan = debt !== undefined ? planFor({ repayAll, input: parsedAmount }, debt) : null;
  const funding = plan?.full && walletValue !== undefined && debt !== undefined ? coreFullRepayFunding(walletValue, debt) : null;
  const shortForPartial = !repayAll && walletValue !== undefined && parsedAmount > walletValue;

  const sendRepay = async (params: RepayParams) => {
    if (!address || !pool) return;
    setNotice(null);
    // Re-validate against the chain right before the wallet prompt (#6).
    const [debtNow, walletNow, allowanceNow] = await Promise.all([
      debtRead.refetch().then((r) => r.data as bigint | undefined),
      wallet.fetchNow(),
      flow.refetchAllowance(),
    ]);
    if (debtNow === undefined || walletNow === undefined || allowanceNow === undefined) {
      setNotice("Could not re-read your debt, wallet or allowance; nothing was sent.");
      return;
    }
    const next = planFor(params, debtNow);
    if (!next) {
      setNotice("Nothing left to repay.");
      return;
    }
    if (next.full) {
      // The pool pulls the debt at execution: wallet and allowance need only the execution headroom
      // over the CURRENT debt (half the approval buffer), not a fresh buffer (Gemini r2 C1).
      const f = coreFullRepayFunding(walletNow, debtNow);
      if (!f.fundable) {
        setNotice(
          `Your wallet (${fmt(walletNow, decimals)} ${symbol}) does not cover the full debt plus the accrual margin. Repay ${fmt(f.partial, decimals)} ${symbol} instead.`,
        );
        return;
      }
      if (!hasExecutionHeadroom({ allowance: allowanceNow, wallet: walletNow, value: debtNow })) {
        setNotice("The debt grew past the approved amount; approve again.");
        return;
      }
    } else {
      // A finite repay pulls exactly the amount (at most the debt): no accrual margin needed.
      if (walletNow < next.amountArg) {
        setNotice("Your wallet balance no longer covers the amount; nothing was sent.");
        return;
      }
      if (allowanceNow < next.amountArg) {
        setNotice("The allowance no longer covers the amount; approve again.");
        return;
      }
    }
    setSubmittedFull(next.full);
    await send({ address: pool, abi: POOL_ABI, functionName: "repay", args: [asset, next.amountArg, 2n, address] });
  };

  const flow = useApprovalFlow<RepayParams>({
    token: asset,
    spender: pool,
    paramsKey: repayAll ? "all" : amount,
    onProceed: sendRepay,
  });
  const needsApproval = plan !== null && flow.needsApproval(plan.approve);

  const prevErrorRef = useRef<Error | null>(null);
  const prevApprovalErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Repayment failed", { description: parseErrorMessage(error) });
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
      toast.success("Repayment successful", { description: "Transaction confirmed", action: explorerToastAction(hash) });
    }
  }, [isSuccess, hash]);

  const handleRepay = () => {
    if (!address || !pool || !plan) return;
    const params = { repayAll, input: parsedAmount };
    if (needsApproval) {
      void flow.start(params, plan.approve);
      return;
    }
    void sendRepay(params);
  };

  const offerPartial = (partial: bigint) => {
    setRepayAll(false);
    setAmount(formatUnits(partial, decimals));
    setNotice(null);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4 space-y-2">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Repayment Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground">
              You repaid {submittedFull ? "your full" : amount} {symbol}{submittedFull ? " debt" : ""}
            </p>
            <PostTxAllowance refetch={flow.refetchAllowance} symbol={symbol} decimals={decimals} spenderLabel="Pool" />
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
                  <span className="font-mono">{debt === undefined ? "—" : fmt(debt, decimals)} {symbol}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Wallet</span>
                  <span className="font-mono">{walletValue === undefined ? "—" : fmt(walletValue, decimals)} {symbol}</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  {repayAll && <span className="text-xs text-accent font-mono">Full debt (updates with accrual)</span>}
                </div>
                <div className="relative">
                  <Input
                    aria-label="Amount"
                    type="number"
                    value={shownAmount}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || (isValidDecimalInput(v, decimals) && Number(v) >= 0)) {
                        setRepayAll(false);
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
                    disabled={debt === undefined || debt === 0n}
                    onClick={() => {
                      setRepayAll(true);
                      setAmount(debt !== undefined ? formatUnits(debt, decimals) : "");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {shortForPartial && <p className="text-xs text-destructive mt-1">Insufficient wallet balance</p>}
                {funding && !funding.fundable && (
                  <div className="text-xs text-amber-400 mt-1 space-y-1" data-testid="partial-offer">
                    <p>Your wallet does not cover the full debt plus the accrual margin (0.05%).</p>
                    <button type="button" className="underline" onClick={() => offerPartial(funding.partial)}>
                      Repay {fmt(funding.partial, decimals)} {symbol} (wallet balance) instead
                    </button>
                  </div>
                )}
                {plan?.full && funding?.fundable && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Full repay: the pool takes your debt as of the repay block (accrual until then is covered).
                  </p>
                )}
                {notice && <p className="text-xs text-amber-400 mt-1" data-testid="repay-notice">{notice}</p>}
                {flow.cancelReason && <p className="text-xs text-amber-400 mt-1">Approval flow cancelled: {flow.cancelReason}.</p>}
              </div>

              <AllowanceNote
                symbol={symbol}
                decimals={decimals}
                spenderLabel="Pool"
                allowance={flow.allowance}
                approveAmount={plan && needsApproval ? plan.approve : undefined}
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
                isPending={isPending || flow.isPending}
                isSimulating={isSimulating || flow.isSimulating}
                isConfirming={isConfirming || flow.isConfirming || flow.awaitingApproval}
                disabled={!address || !plan || walletValue === undefined || shortForPartial || (funding !== null && !funding.fundable)}
              >
                {needsApproval ? `Approve ${symbol}` : `Repay ${symbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
