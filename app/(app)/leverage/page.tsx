"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { TokenIcon } from "@/components/common/TokenIcon";
import { SlippageSelector } from "@/components/common/SlippageSelector";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useUserPosition } from "@/hooks/useUserPosition";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { useDebtDelegation } from "@/hooks/useDebtDelegation";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { LeverageCloseModal } from "@/components/actions/LeverageCloseModal";
import { ADDRESSES } from "@/lib/contracts";
import { ERC20_ABI, LOOPING_ABI } from "@/lib/abis";
import { MARKETS, getMarketBySymbol, getMarketByAsset } from "@/lib/constants";
import { formatPercent, formatTokenAmount, safeParseUnits, isValidDecimalInput } from "@/lib/format";
import { parseErrorMessage } from "@/lib/errorMessages";
import { txExplorerUrl } from "@/lib/explorer";
import {
  DEFAULT_SLIPPAGE_BPS,
  applySlippage,
  quoteExactIn,
  swapDeadline,
  type SlippageBps,
} from "@/lib/slippage";
import { Triangle } from "lucide-react";

const LEVERAGE_OPTIONS = [1.5, 2, 2.5, 3] as const;

// Candidate swapper addresses to probe — extend when more DEX adapters are deployed.
const KNOWN_SWAPPER_CANDIDATES: `0x${string}`[] = [ADDRESSES.swapper];

const MAX_UINT256 = 2n ** 256n - 1n;

export default function LeveragePage() {
  const { address } = useAccount();
  const { markets } = useAllMarkets();
  const { positions } = useUserPosition();

  const [yieldAssetSym, setYieldAssetSym] = useState("LIT");
  const [debtAssetSym, setDebtAssetSym] = useState("USDC");
  const [amountInput, setAmountInput] = useState("");
  const [leverage, setLeverage] = useState<number>(2);
  const [slippageBps, setSlippageBps] = useState<SlippageBps>(DEFAULT_SLIPPAGE_BPS);
  const oracle = useOraclePrices();

  const yieldMarket = getMarketBySymbol(yieldAssetSym);
  const debtMarket = getMarketBySymbol(debtAssetSym);
  const sameAsset = yieldAssetSym === debtAssetSym;

  // -- On-chain looping state --
  const poolWhitelisted = useReadContract({
    address: ADDRESSES.looping,
    abi: LOOPING_ABI,
    functionName: "pools",
    args: [ADDRESSES.pool],
    query: { refetchInterval: 60_000 },
  });

  const swapperProbes = useReadContracts({
    contracts: KNOWN_SWAPPER_CANDIDATES.map((addr) => ({
      address: ADDRESSES.looping,
      abi: LOOPING_ABI,
      functionName: "swappers" as const,
      args: [addr] as const,
    })),
    query: { enabled: KNOWN_SWAPPER_CANDIDATES.length > 0, refetchInterval: 60_000 },
  });
  const activeSwapper = useMemo(() => {
    if (!swapperProbes.data) return undefined;
    for (let i = 0; i < swapperProbes.data.length; i++) {
      if (swapperProbes.data[i]?.result === true) return KNOWN_SWAPPER_CANDIDATES[i];
    }
    return undefined;
  }, [swapperProbes.data]);

  // -- Amount + leverage calc --
  const decimals = debtMarket?.decimals ?? 18;
  const parsedAmount = amountInput ? (safeParseUnits(amountInput, decimals) ?? 0n) : 0n;
  const flashloanAmount = parsedAmount * BigInt(Math.round(leverage * 100)) / 100n;

  // Wallet balance of debt asset (initial deposit)
  const walletBalance = useReadContract({
    address: debtMarket?.asset,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!debtMarket },
  });
  const balance = (walletBalance.data as bigint | undefined) ?? 0n;
  const balanceFormatted = debtMarket ? formatUnits(balance, decimals) : "0";

  // -- Approvals --
  const tokenApproval = useTokenApproval(debtMarket?.asset ?? ("0x0" as `0x${string}`), ADDRESSES.looping, address);
  const delegationApproval = useDebtDelegation(debtMarket?.variableDebtToken, ADDRESSES.looping, address);

  // -- openPosition writeContract --
  const { writeContract, data: openHash, isPending: openPending, error: openError } = useWriteContract();
  const { isLoading: openConfirming, isSuccess: openSuccess } = useWaitForTransactionReceipt({ hash: openHash });

  const prevOpenErr = useRef<Error | null>(null);
  useEffect(() => {
    if (openError && openError !== prevOpenErr.current) {
      prevOpenErr.current = openError;
      toast.error("Open Position failed", { description: parseErrorMessage(openError) });
    }
  }, [openError]);

  useEffect(() => {
    if (openSuccess && openHash) {
      toast.success("Position opened", {
        action: { label: "View", onClick: () => window.open(txExplorerUrl(openHash), "_blank") },
      });
    }
  }, [openSuccess, openHash]);

  const debtPrice = oracle.priceOf(debtMarket?.asset);
  const yieldPrice = oracle.priceOf(yieldMarket?.asset);
  const expectedYieldOut =
    debtMarket && yieldMarket && flashloanAmount > 0n && debtPrice !== undefined && yieldPrice !== undefined
      ? quoteExactIn(flashloanAmount, debtMarket.decimals, yieldMarket.decimals, debtPrice, yieldPrice)
      : 0n;
  const minYieldOut = applySlippage(expectedYieldOut, slippageBps);

  const handleOpen = () => {
    if (!address || !yieldMarket || !debtMarket || !activeSwapper) return;
    if (sameAsset || parsedAmount === 0n) return;
    if (minYieldOut === 0n) {
      toast.error("Open Position blocked", {
        description: "Need a live oracle quote and a nonzero minAmountOut",
      });
      return;
    }
    const path: `0x${string}`[] = [debtMarket.asset, yieldMarket.asset];
    writeContract({
      address: ADDRESSES.looping,
      abi: LOOPING_ABI,
      functionName: "openPosition",
      args: [
        ADDRESSES.pool,
        activeSwapper,
        debtMarket.asset,
        yieldMarket.asset,
        parsedAmount,
        flashloanAmount,
        minYieldOut,
        path,
        false, // _startWithYield: user provides debt token; initial-swap min is unused
        0n,
        swapDeadline(),
      ],
    });
  };

  // -- Display estimates --
  const yieldRate = markets.find((m) => m.symbol === yieldAssetSym)?.supplyRate ?? 0n;
  const borrowRate = markets.find((m) => m.symbol === debtAssetSym)?.borrowRate ?? 0n;
  const baseApy = Number(yieldRate) / 1e25;
  const borrowApy = Number(borrowRate) / 1e25;
  const estimatedApy = baseApy * leverage - borrowApy * (leverage - 1);

  // -- Existing positions: any market with both supply > 0 and borrow > 0 in DIFFERENT assets --
  type OpenLeveragedPos = {
    yield: typeof positions[number];
    debt: typeof positions[number];
  };
  const leveraged: OpenLeveragedPos[] = useMemo(() => {
    const supplied = positions.filter((p) => p.supplied > 0n);
    const borrowed = positions.filter((p) => p.borrowed > 0n);
    const out: OpenLeveragedPos[] = [];
    for (const s of supplied) {
      for (const b of borrowed) {
        if (s.symbol !== b.symbol) out.push({ yield: s, debt: b });
      }
    }
    return out;
  }, [positions]);

  const [closeTarget, setCloseTarget] = useState<OpenLeveragedPos | null>(null);

  // -- Validations --
  const insufficientBalance = parsedAmount > balance;
  const needsTokenApproval = tokenApproval.needsApproval(parsedAmount);
  const needsDelegation = delegationApproval.needsApproval(flashloanAmount);
  const missingQuote = parsedAmount > 0n && !sameAsset && minYieldOut === 0n;
  const ready =
    !!address &&
    !!yieldMarket &&
    !!debtMarket &&
    !sameAsset &&
    parsedAmount > 0n &&
    !insufficientBalance &&
    !needsTokenApproval &&
    !needsDelegation &&
    !!activeSwapper &&
    poolWhitelisted.data === true &&
    minYieldOut > 0n;

  const noSwapper = KNOWN_SWAPPER_CANDIDATES.length === 0 || !activeSwapper;

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">Leverage</h1>
        <p className="text-muted-foreground text-sm">
          One-click leveraged positions using flash loans
        </p>
      </div>

      {noSwapper && (
        <div className="technical-border bg-amber-500/10 border-amber-500/30 p-4 flex items-start gap-3 animate-in-delay-1">
          <Triangle size={14} className="text-amber-400 shrink-0 mt-1" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-400">DEX adapter not yet whitelisted</p>
            <p className="text-xs text-muted-foreground">
              The Looping contract is deployed at <span className="font-mono">{ADDRESSES.looping.slice(0, 8)}…{ADDRESSES.looping.slice(-4)}</span>{" "}
              and the Aave Pool is approved, but no swap adapter is currently whitelisted on Base Sepolia.
              Open Position will be enabled as soon as a DEX adapter is configured.
            </p>
          </div>
        </div>
      )}

      <div className="animate-in-delay-1">
        <div className="technical-border bg-card">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">How It Works</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              The Looping contract uses Aave V3 flash loans to build leverage in a single transaction
            </p>
          </div>
          <div className="p-4 grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-accent">Open Position</h3>
              <p className="text-sm text-muted-foreground">
                Deposit debt-asset &rarr; flash-loan more &rarr; swap to yield asset &rarr; supply &rarr; borrow &rarr; repay flash loan
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-accent">Close Position</h3>
              <p className="text-sm text-muted-foreground">
                Flash-loan debt &rarr; repay debt &rarr; withdraw yield collateral &rarr; swap back &rarr; repay flash loan
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="animate-in-delay-2">
        <div className="technical-border bg-card">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Open Leveraged Position</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              Select assets, deposit, and leverage multiplier
            </p>
          </div>
          <div className="p-4 space-y-6">
            {/* Asset selection */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Yield Asset (long)
                </label>
                <select
                  value={yieldAssetSym}
                  onChange={(e) => setYieldAssetSym(e.target.value)}
                  className="w-full h-10 border border-border bg-background px-3 text-sm font-mono text-foreground focus:border-accent/50 focus:outline-none"
                >
                  {MARKETS.map((m) => (
                    <option key={m.symbol} value={m.symbol} className="bg-background">{m.symbol}</option>
                  ))}
                </select>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Supply APY: {formatPercent(yieldRate)}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Debt Asset (initial deposit + borrow)
                </label>
                <select
                  value={debtAssetSym}
                  onChange={(e) => setDebtAssetSym(e.target.value)}
                  className="w-full h-10 border border-border bg-background px-3 text-sm font-mono text-foreground focus:border-accent/50 focus:outline-none"
                >
                  {MARKETS.map((m) => (
                    <option key={m.symbol} value={m.symbol} className="bg-background">{m.symbol}</option>
                  ))}
                </select>
                <p className="text-[10px] font-mono text-muted-foreground">
                  Borrow APY: {formatPercent(borrowRate)}
                </p>
              </div>
            </div>

            {sameAsset && (
              <p className="text-xs text-amber-400 font-mono">Yield and debt assets must differ</p>
            )}

            {/* Amount */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Initial Deposit ({debtAssetSym})
                </label>
                <span className="text-[10px] text-muted-foreground font-mono">
                  Wallet: {Number(balanceFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })} {debtAssetSym}
                </span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={amountInput}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || (isValidDecimalInput(v, decimals) && Number(v) >= 0)) setAmountInput(v);
                  }}
                  placeholder="0.0"
                  min="0"
                  step="any"
                  className="w-full h-12 text-lg font-mono bg-background border border-border px-4 pr-16 text-foreground placeholder:text-muted-foreground focus:border-accent/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setAmountInput(balanceFormatted)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-accent bg-accent/10 border border-accent/30 px-2.5 py-1 transition-colors"
                >
                  MAX
                </button>
              </div>
              {insufficientBalance && (
                <p className="text-xs text-destructive">Insufficient balance</p>
              )}
            </div>

            {/* Leverage */}
            <div className="space-y-2">
              <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Leverage Multiplier
              </label>
              <div className="flex gap-2">
                {LEVERAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    className={`flex-1 h-10 font-mono font-bold text-sm transition-colors ${
                      leverage === opt
                        ? "bg-accent text-background shadow-[0_0_20px_rgba(176,196,255,0.2)]"
                        : "border border-accent/30 text-accent hover:bg-accent hover:text-background"
                    }`}
                    onClick={() => setLeverage(opt)}
                  >
                    {opt}x
                  </button>
                ))}
              </div>
            </div>

            <SlippageSelector value={slippageBps} onChange={setSlippageBps} />

            {/* Estimate */}
            {parsedAmount > 0n && !sameAsset && (
              <div className="border border-border/50 bg-background/50 p-4 space-y-3">
                <h4 className="text-[10px] font-mono uppercase tracking-wider text-accent">
                  Position Estimate
                </h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Expected yield
                    </p>
                    <p className="text-sm font-mono font-medium text-foreground">
                      {minYieldOut > 0n
                        ? `~${formatTokenAmount(expectedYieldOut, yieldMarket?.decimals ?? 18)} ${yieldAssetSym}`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Flash Loan
                    </p>
                    <p className="text-sm font-mono font-medium text-foreground">
                      {formatUnits(flashloanAmount, decimals)} {debtAssetSym}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Net APY
                    </p>
                    <p className={`text-sm font-mono font-medium ${estimatedApy >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {estimatedApy >= 0 ? "+" : ""}{estimatedApy.toFixed(2)}%
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Min received
                    </p>
                    <p className="text-sm font-mono font-medium text-foreground">
                      {minYieldOut > 0n
                        ? `${formatTokenAmount(minYieldOut, yieldMarket?.decimals ?? 18)} ${yieldAssetSym}`
                        : "quote unavailable"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      Deadline
                    </p>
                    <p className="text-sm font-mono font-medium text-foreground">5 minutes</p>
                  </div>
                </div>
                {missingQuote && (
                  <p className="text-xs text-amber-400 font-mono">
                    Live oracle quote required — open is blocked until minAmountOut is nonzero
                  </p>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              {needsTokenApproval && parsedAmount > 0n && !insufficientBalance && (
                <TxButton
                  onClick={() => tokenApproval.approve(parsedAmount)}
                  isPending={tokenApproval.isPending}
                  isConfirming={tokenApproval.isConfirming}
                  disabled={!address}
                >
                  Step 1: Approve {debtAssetSym}
                </TxButton>
              )}
              {!needsTokenApproval && needsDelegation && parsedAmount > 0n && (
                <TxButton
                  onClick={() => delegationApproval.approve(MAX_UINT256)}
                  isPending={delegationApproval.isPending}
                  isConfirming={delegationApproval.isConfirming}
                  disabled={!address}
                >
                  Step 2: Approve credit delegation
                </TxButton>
              )}
              {!needsTokenApproval && !needsDelegation && (
                <TxButton
                  onClick={handleOpen}
                  isPending={openPending}
                  isConfirming={openConfirming}
                  disabled={!ready}
                >
                  {noSwapper
                    ? "DEX adapter required"
                    : missingQuote
                      ? "Oracle quote required"
                      : "Open Position"}
                </TxButton>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Close modal */}
      {closeTarget && (() => {
        const yMarket = getMarketByAsset(closeTarget.yield.asset);
        const dMarket = getMarketByAsset(closeTarget.debt.asset);
        if (!yMarket || !dMarket) {
          setCloseTarget(null);
          return null;
        }
        return (
          <LeverageCloseModal
            yieldAsset={yMarket.asset}
            yieldSymbol={yMarket.symbol}
            yieldDecimals={yMarket.decimals}
            yieldAToken={yMarket.aToken}
            debtAsset={dMarket.asset}
            debtSymbol={dMarket.symbol}
            debtDecimals={dMarket.decimals}
            debtVariableToken={dMarket.variableDebtToken}
            swapper={activeSwapper}
            onClose={() => setCloseTarget(null)}
          />
        );
      })()}

      {/* Existing positions */}
      <div className="animate-in-delay-3">
        <div className="technical-border bg-card">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Active Positions</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              Cross-asset positions detected from your supply + borrow balances
            </p>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Yield</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Debt</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Supplied</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Borrowed</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {leveraged.length === 0 ? (
                <tr>
                  <td colSpan={5} className="h-32 text-center text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">No active leveraged positions</p>
                    <p className="text-xs text-muted-foreground mt-1">Open one above to get started</p>
                  </td>
                </tr>
              ) : (
                leveraged.map((p) => (
                  <tr key={`${p.yield.symbol}-${p.debt.symbol}`} className="border-b border-border/50 hover:bg-white/5">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2"><TokenIcon symbol={p.yield.symbol} size={20} /> <span className="font-mono text-sm">{p.yield.symbol}</span></div>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2"><TokenIcon symbol={p.debt.symbol} size={20} /> <span className="font-mono text-sm">{p.debt.symbol}</span></div>
                    </td>
                    <td className="px-6 py-3 font-mono text-sm text-right">
                      {Number(formatUnits(p.yield.supplied, p.yield.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-6 py-3 font-mono text-sm text-right">
                      {Number(formatUnits(p.debt.borrowed, p.debt.decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 })}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        onClick={() => setCloseTarget(p)}
                        className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
