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
import { Skeleton } from "@/components/ui/skeleton";

type ModalState =
  | { type: "lend" | "borrow"; pair: IsolatedPairInfo }
  | { type: "withdraw" | "repay" | "removeCollateral"; pos: UserIsolatedPosition }
  | null;

function fmt(value: bigint, decimals: number, max = 4): string {
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: max });
}

export default function IsolatedPage() {
  const { isConnected } = useAccount();
  const { pairs, isLoading: pairsLoading } = useIsolatedPairs();
  const { positions, isLoading: positionsLoading } = useUserIsolatedPositions();
  const [modal, setModal] = useState<ModalState>(null);

  return (
    <div className="space-y-6">
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
          </div>
          <div className="technical-border bg-card overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Pair</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Lent</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Borrowed</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Collateral</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positionsLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-4"><Skeleton className="h-8 w-full" /></td>
                  </tr>
                ) : positions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="h-24 text-center text-muted-foreground text-xs px-6">
                      No active positions. Lend or borrow on a pair below to get started.
                    </td>
                  </tr>
                ) : (
                  positions.map((p) => (
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
                      <td className="px-6 py-4 text-right">
                        <div className="flex gap-1.5 justify-end flex-wrap">
                          {p.suppliedShares > 0n && (
                            <button
                              onClick={() => setModal({ type: "withdraw", pos: p })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Withdraw
                            </button>
                          )}
                          {p.borrowedShares > 0n && (
                            <button
                              onClick={() => setModal({ type: "repay", pos: p })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Repay
                            </button>
                          )}
                          {p.collateralAmount > 0n && (
                            <button
                              onClick={() => setModal({ type: "removeCollateral", pos: p })}
                              className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
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
                <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {pairsLoading ? (
                [0, 1].map((i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td colSpan={8} className="px-6 py-4"><Skeleton className="h-8 w-full" /></td>
                  </tr>
                ))
              ) : pairs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="h-32 text-center text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">No isolated pairs deployed yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Pairs will appear here once the registry is populated</p>
                  </td>
                </tr>
              ) : (
                pairs.map((p) => (
                  <tr key={p.pair} className="border-b border-border/50 hover:bg-white/5">
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
                    <td className="px-6 py-4 font-mono text-sm text-right">{p.utilization.toFixed(1)}%</td>
                    <td className="px-6 py-4 font-mono text-sm text-right">{(Number(p.maxLTV) / 1000).toFixed(0)}%</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex gap-1.5 justify-end">
                        <button
                          onClick={() => setModal({ type: "lend", pair: p })}
                          className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                        >
                          Lend
                        </button>
                        <button
                          onClick={() => setModal({ type: "borrow", pair: p })}
                          className="px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
                        >
                          Borrow
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.type === "lend" && (
        <IsolatedLendModal
          pair={modal.pair.pair}
          asset={modal.pair.asset}
          assetSymbol={modal.pair.assetSymbol}
          assetDecimals={modal.pair.assetDecimals}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "borrow" && (
        <IsolatedBorrowModal
          pair={modal.pair.pair}
          assetSymbol={modal.pair.assetSymbol}
          assetDecimals={modal.pair.assetDecimals}
          collateral={modal.pair.collateral}
          collateralSymbol={modal.pair.collateralSymbol}
          collateralDecimals={modal.pair.collateralDecimals}
          maxLTV={modal.pair.maxLTV}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "withdraw" && (
        <IsolatedWithdrawModal
          pair={modal.pos.pair}
          assetSymbol={modal.pos.assetSymbol}
          assetDecimals={modal.pos.assetDecimals}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "repay" && (
        <IsolatedRepayModal
          pair={modal.pos.pair}
          asset={modal.pos.asset}
          assetSymbol={modal.pos.assetSymbol}
          assetDecimals={modal.pos.assetDecimals}
          borrowedAmount={modal.pos.borrowedAssets}
          borrowedShares={modal.pos.borrowedShares}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "removeCollateral" && (
        <IsolatedRemoveCollateralModal
          pair={modal.pos.pair}
          collateralSymbol={modal.pos.collateralSymbol}
          collateralDecimals={modal.pos.collateralDecimals}
          collateralAmount={modal.pos.collateralAmount}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
