"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { TokenIcon } from "@/components/common/TokenIcon";
import { useIsolatedPairs, type IsolatedPairInfo } from "@/hooks/useIsolatedPairs";
import { useUserIsolatedPositions, type UserIsolatedPosition } from "@/hooks/useUserIsolatedPositions";
import { IsolatedLendModal } from "@/components/actions/IsolatedLendModal";
import { IsolatedBorrowModal } from "@/components/actions/IsolatedBorrowModal";
import { IsolatedWithdrawModal } from "@/components/actions/IsolatedWithdrawModal";
import { IsolatedRepayModal } from "@/components/actions/IsolatedRepayModal";
import { IsolatedRemoveCollateralModal } from "@/components/actions/IsolatedRemoveCollateralModal";
import { IsolatedAddCollateralModal } from "@/components/actions/IsolatedAddCollateralModal";
import { FreshnessStamp } from "@/components/common/FreshnessStamp";
import { GuardNotice } from "@/components/common/GuardNotice";
import { DeploymentNotice } from "@/components/common/DeploymentNotice";
import { Skeleton } from "@/components/ui/skeleton";
import { isolatedLtv } from "@/lib/borrowMax";
import { oldestStamp } from "@/lib/valuation";
import { collateralPerWholeAsset } from "@/lib/prices";

type DeployedPair = IsolatedPairInfo & { pair: `0x${string}` };
type DeployedPosition = UserIsolatedPosition & { pair: `0x${string}` };

/** Only the pair address lives in modal state; each modal re-derives live data (Codex #8). */
type ModalState = {
  type: "lend" | "borrow" | "withdraw" | "repay" | "removeCollateral" | "addCollateral";
  pair: `0x${string}`;
} | null;

const isDeployedPair = (p: IsolatedPairInfo): p is DeployedPair => p.pair !== null;

function fmt(value: bigint | undefined, decimals: number, max = 4): string {
  if (value === undefined) return "—";
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}

export default function IsolatedPage() {
  const { isConnected } = useAccount();
  const { pairs, isLoading: pairsLoading } = useIsolatedPairs();
  const {
    positions,
    unknownPairs,
    stamp,
    conversionStamp,
    pairsStamp,
    isLoading: positionsLoading,
  } = useUserIsolatedPositions();
  // The table combines snapshots, conversions and pair rates: show the oldest of their blocks.
  const tableStamp = oldestStamp([stamp, conversionStamp, pairsStamp]);
  const [modal, setModal] = useState<ModalState>(null);

  return (
    <div className="space-y-6">
      <DeploymentNotice />
      <GuardNotice venue="isolated" />
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">Isolated Markets</h1>
        <p className="text-muted-foreground text-sm">
          Risk-isolated lending pairs with independent collateral
        </p>
      </div>

      <div className="animate-in-delay-1">
        <div className="technical-border bg-card">
          <div className="p-4 border-b border-border/50">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">How Isolated Pairs Work</h2>
            <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
              Each pair is independent — one borrowable asset paired with one collateral
            </p>
          </div>
          <div className="p-4">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">&#x2022;</span>
                <span>Failure in one pair never affects others — risk is fully contained</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">&#x2022;</span>
                <span>Lenders deposit the asset, borrowers post collateral and draw the asset against it</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-accent mt-0.5">&#x2022;</span>
                <span>Higher LTVs are possible for specific, well-understood pairs</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Your Positions */}
      {isConnected && (
        <div className="animate-in-delay-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Your Positions</span>
            <span className="ml-auto"><FreshnessStamp stamp={tableStamp} /></span>
          </div>
          <div className="technical-border bg-card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Pair</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Lent</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Borrowed</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Collateral</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">LTV</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positionsLoading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4"><Skeleton className="h-8 w-full" /></td>
                  </tr>
                ) : positions.length === 0 && unknownPairs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="h-24 text-center text-muted-foreground text-xs px-6">
                      No active positions. Lend or borrow on a pair below to get started.
                    </td>
                  </tr>
                ) : (
                  <>
                  {/* A pair whose snapshot failed is flagged, not dropped (Gemini r2 m2). */}
                  {unknownPairs.map((pairAddress) => {
                    const pairInfo = pairs.find((x) => x.pair?.toLowerCase() === pairAddress);
                    return (
                      <tr key={`unknown-${pairAddress}`} className="border-b border-border/50" data-testid="unknown-position-row">
                        <td className="px-6 py-4 font-mono text-sm">{pairInfo ? `${pairInfo.assetSymbol}/${pairInfo.collateralSymbol}` : pairAddress}</td>
                        <td colSpan={5} className="px-6 py-4 text-right text-xs text-amber-400">
                          Position unavailable: the read failed or is still loading
                        </td>
                      </tr>
                    );
                  })}
                  {positions.filter((p): p is DeployedPosition => p.pair !== null).map((p) => {
                    const ltv =
                      p.exchangeRate !== undefined && p.borrowedAssets !== undefined
                        ? isolatedLtv(p.borrowedAssets, p.collateralAmount, p.exchangeRate)
                        : null;
                    return (
                    <tr key={p.pair} className="border-b border-border/50 hover:bg-white/5">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <TokenIcon symbol={p.assetSymbol} size={20} />
                          <span className="text-muted-foreground">/</span>
                          <TokenIcon symbol={p.collateralSymbol} size={20} />
                          <span className="font-mono text-sm ml-2">{p.assetSymbol}/{p.collateralSymbol}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-right">
                        {p.suppliedShares > 0n ? `${fmt(p.suppliedAssets, p.assetDecimals)} ${p.assetSymbol}` : "—"}
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-right">
                        {p.borrowedShares > 0n ? `${fmt(p.borrowedAssets, p.assetDecimals, 6)} ${p.assetSymbol}` : "—"}
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-right">
                        {p.collateralAmount > 0n ? `${fmt(p.collateralAmount, p.collateralDecimals)} ${p.collateralSymbol}` : "—"}
                      </td>
                      <td className="px-6 py-4 font-mono text-sm text-right">
                        {p.borrowedShares > 0n && ltv !== null && p.maxLTV !== undefined
                          ? `${(Number(ltv) / 1000).toFixed(2)}% / ${(Number(p.maxLTV) / 1000).toFixed(0)}%`
                          : "—"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex gap-1.5 justify-end flex-wrap">
                          {p.suppliedShares > 0n && (
                            <button
                              onClick={() => setModal({ type: "withdraw", pair: p.pair })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Withdraw
                            </button>
                          )}
                          {p.borrowedShares > 0n && (
                            <button
                              onClick={() => setModal({ type: "repay", pair: p.pair })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Repay
                            </button>
                          )}
                          {(p.collateralAmount > 0n || p.borrowedShares > 0n) && (
                            <button
                              onClick={() => setModal({ type: "addCollateral", pair: p.pair })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Add collateral
                            </button>
                          )}
                          {p.collateralAmount > 0n && (
                            <button
                              onClick={() => setModal({ type: "removeCollateral", pair: p.pair })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All pairs */}
      <div className="animate-in-delay-3">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-accent">All Pairs</span>
        </div>
        <div className="technical-border bg-card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Pair</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Asset</th>
                <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Collateral</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Total Supplied</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Total Borrowed</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Util</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Max LTV</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Rate</th>
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {pairsLoading ? (
                [0, 1].map((i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td colSpan={9} className="px-6 py-4"><Skeleton className="h-8 w-full" /></td>
                  </tr>
                ))
              ) : pairs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="h-32 text-center text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">No isolated pairs in the deployment manifest</p>
                  </td>
                </tr>
              ) : (
                pairs.map((p) => (
                  <tr key={p.name} className="border-b border-border/50 hover:bg-white/5">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <TokenIcon symbol={p.assetSymbol} size={20} />
                        <span className="text-muted-foreground">/</span>
                        <TokenIcon symbol={p.collateralSymbol} size={20} />
                        <span className="font-mono text-sm ml-2">{p.assetSymbol}/{p.collateralSymbol}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-sm">{p.assetSymbol}</td>
                    <td className="px-6 py-4 font-mono text-sm">{p.collateralSymbol}</td>
                    <td className="px-6 py-4 font-mono text-sm text-right">{fmt(p.totalAssetAmount, p.assetDecimals)}</td>
                    <td className="px-6 py-4 font-mono text-sm text-right">{fmt(p.totalBorrowAmount, p.assetDecimals)}</td>
                    <td className="px-6 py-4 font-mono text-sm text-right">{p.utilization === undefined ? "—" : `${p.utilization.toFixed(1)}%`}</td>
                    <td className="px-6 py-4 font-mono text-sm text-right">{p.maxLTV === undefined ? "—" : `${(Number(p.maxLTV) / 1000).toFixed(0)}%`}</td>
                    <td className="px-6 py-4 font-mono text-xs text-right" title="Pair oracle: collateral per 1 asset">
                      {p.exchangeRate !== undefined
                        ? `1 ${p.assetSymbol} = ${fmt(
                            collateralPerWholeAsset(p.exchangeRate, p.assetDecimals),
                            p.collateralDecimals,
                            6,
                          )} ${p.collateralSymbol}`
                        : "—"}
                      {p.oracleBadData && <div className="text-amber-400">borrows blocked</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {isDeployedPair(p) ? (
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => setModal({ type: "lend", pair: p.pair })}
                            className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                          >
                            Lend
                          </button>
                          <button
                            onClick={() => setModal({ type: "borrow", pair: p.pair })}
                            className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                          >
                            Borrow
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-text-dim uppercase">Not deployed</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.type === "lend" && <IsolatedLendModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "borrow" && <IsolatedBorrowModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "withdraw" && <IsolatedWithdrawModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "repay" && <IsolatedRepayModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "removeCollateral" && <IsolatedRemoveCollateralModal pair={modal.pair} onClose={() => setModal(null)} />}
      {modal?.type === "addCollateral" && <IsolatedAddCollateralModal pair={modal.pair} onClose={() => setModal(null)} />}
    </div>
  );
}
