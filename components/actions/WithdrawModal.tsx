"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { safeParseUnits, isValidDecimalInput, formatHealthFactor, MAX_HEALTH_FACTOR } from "@/lib/format";
import { explorerToastAction } from "@/lib/explorer";
import { AAVE_ENTIRE_BALANCE } from "@/lib/approvals";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useLuminaWrite } from "@/hooks/chain";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { TxButton } from "@/components/common/TxButton";
import { ExplorerLink } from "@/components/common/ExplorerLink";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface WithdrawModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

/**
 * Core withdraw. MAX sets a "withdraw all" intent, kept apart from the amount text until the user
 * edits it; with it the withdraw sends Aave's entire-balance sentinel, so interest accrued after
 * the last poll is withdrawn too and no dust aTokens remain (FE-09, Codex #5).
 */
export function WithdrawModal({ asset, symbol, decimals, onClose }: WithdrawModalProps) {
  const [amount, setAmount] = useState("");
  const [withdrawAll, setWithdrawAll] = useState(false);
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();
  const { positions, accountData, stamp } = useUserPosition();
  const { priceOf } = useOraclePrices();
  const { getMarket } = useAllMarkets();

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;
  const position = positions.find((p) => p.asset.toLowerCase() === asset.toLowerCase());
  const supplied = position?.supplied;
  const suppliedFormatted = supplied === undefined ? "" : formatUnits(supplied, decimals);
  const shownAmount = withdrawAll && supplied !== undefined ? suppliedFormatted : amount;
  // With the intent, what leaves is the whole (polled) balance.
  const effectiveAmount = withdrawAll ? (supplied ?? 0n) : parsedAmount;
  const liquidity = getMarket(asset)?.availableLiquidity;

  const healthFactor = accountData?.healthFactor;
  const isMaxHf = healthFactor === MAX_HEALTH_FACTOR;
  const priceRaw = priceOf(asset) ?? 0n;
  const totalCollateralBase = accountData?.totalCollateralBase ?? 0n;
  const totalDebtBase = accountData?.totalDebtBase ?? 0n;
  const currentLiquidationThreshold = accountData?.currentLiquidationThreshold ?? 0n;
  // Post-withdraw HF (display only), counting the withdrawn value only if it is collateral.
  const withdrawValueInBase =
    effectiveAmount > 0n && priceRaw > 0n && position?.collateralEnabled
      ? (effectiveAmount * priceRaw) / 10n ** BigInt(decimals)
      : 0n;
  const newTotalCollateral = totalCollateralBase > withdrawValueInBase ? totalCollateralBase - withdrawValueInBase : 0n;
  let simulatedHf: number | null = null;
  if (totalDebtBase > 0n && effectiveAmount > 0n) {
    const collateralWeighted = (newTotalCollateral * currentLiquidationThreshold) / 10_000n;
    simulatedHf = Number((collateralWeighted * 10n ** 18n) / totalDebtBase) / 1e18;
  }
  const simulatedHfColor = simulatedHf === null ? "text-muted-foreground"
    : simulatedHf >= 2 ? "text-emerald-400"
    : simulatedHf >= 1.2 ? "text-amber-400"
    : "text-red-400";

  const prevErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Withdrawal failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Withdrawal successful", { description: "Transaction confirmed", action: explorerToastAction(hash) });
    }
  }, [isSuccess, hash]);

  const handleWithdraw = () => {
    if (!address || !pool || effectiveAmount === 0n) return;
    void send({
      address: pool,
      abi: POOL_ABI,
      functionName: "withdraw",
      args: [asset, withdrawAll ? AAVE_ENTIRE_BALANCE : parsedAmount, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Withdrawal Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">You withdrew {withdrawAll ? "all your" : amount} {symbol}</p>
            {hash && <ExplorerLink hash={hash} />}
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Withdraw {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Supplied: <span className="font-mono">{supplied === undefined ? "—" : Number(suppliedFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span> {symbol}
                  </span>
                </div>
                <div className="relative">
                  <Input
                    aria-label="Amount"
                    type="number"
                    value={shownAmount}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || (isValidDecimalInput(v, decimals) && Number(v) >= 0)) {
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
                    disabled={supplied === undefined || supplied === 0n}
                    onClick={() => {
                      setWithdrawAll(true);
                      setAmount(suppliedFormatted);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {withdrawAll && <p className="text-xs text-accent mt-1">Withdraw all: the whole balance at execution, interest included.</p>}
                {supplied !== undefined && !withdrawAll && parsedAmount > supplied && (
                  <p className="text-xs text-destructive mt-1">Amount exceeds supplied balance</p>
                )}
                {liquidity !== undefined && effectiveAmount > liquidity && (
                  <p className="text-xs text-amber-500 mt-1">Exceeds the reserve&apos;s available liquidity</p>
                )}
                <div className="mt-1"><FreshnessStamp stamp={stamp} label="Balance" /></div>
              </div>

              {healthFactor !== undefined && (
                <div className="technical-border bg-background p-3 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <div className="flex items-center gap-2 font-mono font-medium">
                      <span>{formatHealthFactor(healthFactor)}</span>
                      {simulatedHf !== null && (
                        <>
                          <span className="text-muted-foreground">&rarr;</span>
                          <span className={simulatedHfColor}>{simulatedHf.toFixed(2)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {simulatedHf !== null && simulatedHf < 1.0 && (
                    <p className="text-xs text-red-500 font-medium">This withdrawal would put you below the liquidation threshold.</p>
                  )}
                  {simulatedHf !== null && simulatedHf >= 1.0 && simulatedHf < 1.5 && (
                    <p className="text-xs text-amber-500 font-medium">
                      Warning: withdrawing lowers your health factor and increases liquidation risk.
                    </p>
                  )}
                  {isMaxHf && <p className="text-xs text-muted-foreground">No debt: withdrawal does not affect a health factor</p>}
                </div>
              )}

              <TxButton
                onClick={handleWithdraw}
                isPending={isPending}
                isSimulating={isSimulating}
                isConfirming={isConfirming}
                disabled={!address || supplied === undefined || effectiveAmount === 0n || (!withdrawAll && parsedAmount > supplied)}
              >
                Withdraw {symbol}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
