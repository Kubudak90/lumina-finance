"use client";

import { useState, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { safeParseUnits, isValidDecimalInput, formatHealthFactor, MAX_HEALTH_FACTOR } from "@/lib/format";
import { explorerToastAction } from "@/lib/explorer";
import { coreBorrowMaxFromReads } from "@/lib/borrowMax";
import { POOL_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { parseErrorMessage } from "@/lib/errorMessages";
import { useLuminaWrite } from "@/hooks/chain";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { useGuardStatus } from "@/hooks/useGuardStatus";
import { TxButton } from "@/components/common/TxButton";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { ExplorerLink } from "@/components/common/ExplorerLink";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { GuardNotice } from "@/components/common/GuardNotice";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface BorrowModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

const fmt = (value: bigint, decimals: number, max = 4) =>
  Number(formatUnits(value, decimals)).toLocaleString("en-US", { maximumFractionDigits: max });

export function BorrowModal({ asset, symbol, decimals, onClose }: BorrowModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const pool = LUMINA.contracts.pool;
  const { send, hash, isPending, isConfirming, isSuccess, error, isSimulating } = useLuminaWrite();
  const { accountData, stamp } = useUserPosition();
  const { getMarket } = useAllMarkets();
  const { priceOf } = useOraclePrices();
  const guard = useGuardStatus();

  const parsedAmount = amount ? (safeParseUnits(amount, decimals) ?? 0n) : 0n;
  const market = getMarket(asset);
  const price = priceOf(asset);
  const priceRaw = price ?? 0n;
  const healthFactor = accountData?.healthFactor;
  const totalDebtBase = accountData?.totalDebtBase ?? 0n;
  const totalCollateralBase = accountData?.totalCollateralBase ?? 0n;
  const currentLiquidationThreshold = accountData?.currentLiquidationThreshold ?? 0n;
  const availableLiquidity = market?.availableLiquidity;

  // FE-05: LTV-based capacity (availableBorrowsBase), 99% haircut, capped by liquidity and the
  // borrow cap, in bigint, floored to base units. null ("unavailable") when any input read failed
  // or is still loading — never computed from a missing value (Codex #9).
  const maxBorrow = coreBorrowMaxFromReads({
    availableBorrowsBase: accountData?.availableBorrowsBase,
    assetPriceBase: price,
    decimals,
    availableLiquidity,
    borrowCapTokens: market?.borrowCap,
    totalDebt: market?.totalDebt,
  });
  const capacityTokens =
    accountData && price !== undefined && price > 0n
      ? (accountData.availableBorrowsBase * 10n ** BigInt(decimals)) / price
      : undefined;

  // Post-borrow HF (display only): (collateral × LT) / (debt + amount × price).
  const collateralWeighted = (totalCollateralBase * currentLiquidationThreshold) / 10_000n;
  const borrowValueInBase = parsedAmount > 0n && priceRaw > 0n ? (parsedAmount * priceRaw) / 10n ** BigInt(decimals) : 0n;
  const newTotalDebt = totalDebtBase + borrowValueInBase;
  let simulatedHf: number | null = null;
  if (newTotalDebt > 0n && parsedAmount > 0n) {
    simulatedHf = Number((collateralWeighted * 10n ** 18n) / newTotalDebt) / 1e18;
  }
  const simulatedHfColor = simulatedHf === null ? "text-muted-foreground"
    : simulatedHf >= 2 ? "text-emerald-400"
    : simulatedHf >= 1.2 ? "text-amber-400"
    : "text-red-400";
  const isMaxHf = healthFactor === MAX_HEALTH_FACTOR;
  const overMax = maxBorrow !== null && parsedAmount > maxBorrow;

  const prevErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Borrow failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Borrow successful", { description: "Transaction confirmed", action: explorerToastAction(hash) });
    }
  }, [isSuccess, hash]);

  const handleBorrow = () => {
    if (!address || !pool) return;
    void send({
      address: pool,
      abi: POOL_ABI,
      functionName: "borrow",
      args: [asset, parsedAmount, 2n, 0, address],
    });
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-4 text-accent">&#10003;</div>
            <DialogHeader className="items-center">
              <DialogTitle className="text-xl">Borrow Successful</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground mt-2 mb-4">You borrowed {amount} {symbol}</p>
            {hash && <ExplorerLink hash={hash} />}
            <Button variant="link" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Borrow {symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <GuardNotice venue="core" />

              <div className="technical-border bg-background p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Borrow capacity (LTV)</span>
                  <span className="font-mono">{capacityTokens === undefined ? "unavailable" : `${fmt(capacityTokens, decimals)} ${symbol}`}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pool liquidity</span>
                  <span className="font-mono">{availableLiquidity === undefined ? "unavailable" : `${fmt(availableLiquidity, decimals)} ${symbol}`}</span>
                </div>
                {market?.borrowCap !== undefined && market.borrowCap > 0n && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Borrow cap</span>
                    <span className="font-mono">{market.borrowCap.toString()} {symbol}</span>
                  </div>
                )}
                <FreshnessStamp stamp={stamp} label="Account" />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-muted-foreground">Amount</label>
                  <span className="text-sm text-muted-foreground">
                    Max (99%):{" "}
                    <span className="font-mono" data-testid="borrow-max">
                      {maxBorrow === null ? "unavailable" : `${fmt(maxBorrow, decimals)} ${symbol}`}
                    </span>
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
                    disabled={maxBorrow === null}
                    onClick={() => maxBorrow !== null && setAmount(formatUnits(maxBorrow, decimals))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {overMax && parsedAmount > 0n && (
                  <p className="text-xs text-destructive mt-1">Amount exceeds what you can borrow (LTV, liquidity or cap)</p>
                )}
              </div>

              {healthFactor !== undefined && (
                <div className="technical-border bg-background p-3 space-y-2">
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
                  <HealthFactorBar healthFactor={healthFactor} />
                  {isMaxHf && simulatedHf === null && (
                    <p className="text-xs text-muted-foreground">No debt yet: borrowing needs collateral enabled</p>
                  )}
                  {simulatedHf !== null && simulatedHf < 1.2 && (
                    <p className="text-xs text-red-500 font-medium">
                      Warning: health factor will be critically low after this borrow. High liquidation risk.
                    </p>
                  )}
                  {simulatedHf !== null && simulatedHf >= 1.2 && simulatedHf < 1.5 && (
                    <p className="text-xs text-amber-500 font-medium">
                      Warning: health factor will be low. Monitor your position closely.
                    </p>
                  )}
                </div>
              )}

              <TxButton
                onClick={handleBorrow}
                isPending={isPending}
                isSimulating={isSimulating}
                isConfirming={isConfirming}
                disabled={!address || parsedAmount === 0n || overMax || !guard.borrowAllowed}
              >
                {!guard.borrowAllowed ? "Borrowing blocked" : `Borrow ${symbol}`}
              </TxButton>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
