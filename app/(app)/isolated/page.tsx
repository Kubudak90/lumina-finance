"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { PairIcons } from "@/components/overview/FixedTokenIcon";
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
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { oldestStamp } from "@/lib/valuation";
import { collateralPerWholeAsset, formatUsd, isolatedCollateralUsd, usdValue } from "@/lib/prices";
import { formatApy, formatPairPrice, formatTokenAmount } from "@/lib/format";
import { aprToApy, formatHealth, formatMaxLtvPercent, isolatedLtvOf } from "@/lib/risk";

type DeployedPair = IsolatedPairInfo & { pair: `0x${string}` };
type DeployedPosition = UserIsolatedPosition & { pair: `0x${string}` };

/** Only the pair address lives in modal state; each modal re-derives live data (Codex #8). */
type ModalState = {
  type: "lend" | "borrow" | "withdraw" | "repay" | "removeCollateral" | "addCollateral";
  pair: `0x${string}`;
} | null;

const isDeployedPair = (p: IsolatedPairInfo): p is DeployedPair => p.pair !== null;

/** Header and cell classes: tight padding so every column fits its card at 1024 px. */
const TH = "text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-3 py-3 align-bottom";
const TD = "px-3 py-3 align-top";
/** Numbers: one line each, a size down below xl (1280 px). */
const NUM = `${TD} font-mono text-xs xl:text-sm text-right whitespace-nowrap`;
/**
 * Util and Price get their own columns from xl (1280 px). Below xl the same values show as
 * sublines (under Total Borrowed and under the pair name), so every value is visible at every
 * width and the table still fits its card at 1024 px.
 */
const XL = "hidden xl:table-cell";
const BELOW_XL = "xl:hidden";
/** All Pairs columns: 9 from xl, 7 below (Util and Price become sublines). */
const PAIR_COLUMNS = { xl: 9, belowXl: 7 } as const;

/** A full-width cell in an All Pairs row, spanning the columns visible at each width. */
function FullRow({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <>
      <td colSpan={PAIR_COLUMNS.belowXl} className={`${className} ${BELOW_XL}`}>
        {children}
      </td>
      <td colSpan={PAIR_COLUMNS.xl} className={`${className} ${XL}`}>
        {children}
      </td>
    </>
  );
}
const BTN =
  "px-2.5 py-1 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono whitespace-nowrap";

function PairName({ asset, collateral }: { asset: string; collateral: string }) {
  return (
    <div className="flex items-center gap-2">
      <PairIcons asset={asset} collateral={collateral} size={20} />
      <span className="font-mono text-sm whitespace-nowrap">
        {asset}/{collateral}
      </span>
    </div>
  );
}

/** A token amount through the app's one amount formatter (lib/format), "—" when unavailable. */
function fmt(value: bigint | undefined, decimals: number): string {
  return value === undefined ? "—" : formatTokenAmount(value, decimals);
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
  // USD from AaveOracle prices only (FE-06); "—" when a price or the pair rate is missing.
  const { priceOf, stamp: priceStamp } = useOraclePrices();
  const deployedPositions = positions.filter((p): p is DeployedPosition => p.pair !== null);
  // The table combines snapshots, conversions and pair rates, and its position rows show USD at
  // oracle prices: show the oldest of the blocks the visible rows use (FE-07).
  const tableStamp = oldestStamp(
    deployedPositions.length > 0 ? [stamp, conversionStamp, pairsStamp, priceStamp] : [stamp, conversionStamp, pairsStamp],
  );
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
          <div className="technical-border bg-card">
            {/* Fits at 1024 px; an unusually long value scrolls inside the card, never the page. */}
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className={`${TH} text-left`}>Pair</th>
                  <th className={`${TH} text-right`}>Lent</th>
                  <th className={`${TH} text-right`}>Borrowed</th>
                  <th className={`${TH} text-right`}>Collateral</th>
                  <th className={`${TH} text-right`}>LTV</th>
                </tr>
              </thead>
              {positionsLoading ? (
                <tbody>
                  <tr>
                    <td colSpan={5} className="px-3 py-4"><Skeleton className="h-8 w-full" /></td>
                  </tr>
                </tbody>
              ) : positions.length === 0 && unknownPairs.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={5} className="h-24 text-center text-muted-foreground text-xs px-3">
                      No active positions. Lend or borrow on a pair below to get started.
                    </td>
                  </tr>
                </tbody>
              ) : (
                <>
                  {/* A pair whose snapshot failed is flagged, not dropped (Gemini r2 m2). */}
                  {unknownPairs.map((pairAddress) => {
                    const pairInfo = pairs.find((x) => x.pair?.toLowerCase() === pairAddress);
                    return (
                      <tbody key={`unknown-${pairAddress}`} className="border-b border-border/50">
                        <tr data-testid="unknown-position-row">
                          <td className={`${TD} font-mono text-sm whitespace-nowrap`}>
                            {pairInfo ? `${pairInfo.assetSymbol}/${pairInfo.collateralSymbol}` : pairAddress}
                          </td>
                          <td colSpan={4} className={`${TD} text-right text-xs text-amber-400`}>
                            Position unavailable: the read failed or is still loading
                          </td>
                        </tr>
                      </tbody>
                    );
                  })}
                  {/* One <tbody> per position: its data row, then its actions on a full-width line. */}
                  {deployedPositions.map((p) => {
                    const price = priceOf(p.asset);
                    // LTV and its status from lib/risk (debt with no collateral reads ∞, never "—").
                    const health = formatHealth({
                      kind: "ltv",
                      ltv: isolatedLtvOf({ debt: p.borrowedAssets, collateral: p.collateralAmount, maxLTV: p.maxLTV, exchangeRate: p.exchangeRate }),
                      maxLTV: p.maxLTV,
                    });
                    return (
                      <tbody key={p.pair} className="border-b border-border/50 hover:bg-white/5">
                        <tr>
                          <td className={TD}>
                            <PairName asset={p.assetSymbol} collateral={p.collateralSymbol} />
                          </td>
                          <td className={NUM}>
                            {p.suppliedShares > 0n ? (
                              <>
                                <div>{fmt(p.suppliedAssets, p.assetDecimals)} {p.assetSymbol}</div>
                                <div className="text-[10px] text-text-dim" data-testid="lent-usd">{formatUsd(usdValue(p.suppliedAssets, p.assetDecimals, price))}</div>
                              </>
                            ) : "—"}
                          </td>
                          <td className={NUM}>
                            {p.borrowedShares > 0n ? (
                              <>
                                <div>{fmt(p.borrowedAssets, p.assetDecimals)} {p.assetSymbol}</div>
                                <div className="text-[10px] text-text-dim" data-testid="borrowed-usd">{formatUsd(usdValue(p.borrowedAssets, p.assetDecimals, price))}</div>
                              </>
                            ) : "—"}
                          </td>
                          <td className={NUM}>
                            {p.collateralAmount > 0n ? (
                              <>
                                <div>{fmt(p.collateralAmount, p.collateralDecimals)} {p.collateralSymbol}</div>
                                <div className="text-[10px] text-text-dim" data-testid="collateral-usd">
                                  {formatUsd(isolatedCollateralUsd(p.collateralAmount, p.exchangeRate, p.assetDecimals, price))}
                                </div>
                              </>
                            ) : "—"}
                          </td>
                          <td className={NUM}>
                            {p.borrowedShares > 0n ? (
                              <>
                                <div>{health.value}{p.maxLTV !== undefined ? ` / ${formatMaxLtvPercent(p.maxLTV)}` : ""}</div>
                                <div className="text-[10px] text-text-dim whitespace-normal">{health.statusLabel}{p.oracleBadData ? " · price data stale" : ""}</div>
                              </>
                            ) : "—"}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="px-3 pb-3 pt-0">
                            <div className="flex gap-1.5 justify-end flex-wrap">
                              {p.suppliedShares > 0n && (
                                <button onClick={() => setModal({ type: "withdraw", pair: p.pair })} className={BTN}>
                                  Withdraw
                                </button>
                              )}
                              {p.borrowedShares > 0n && (
                                <button onClick={() => setModal({ type: "repay", pair: p.pair })} className={BTN}>
                                  Repay
                                </button>
                              )}
                              {(p.collateralAmount > 0n || p.borrowedShares > 0n) && (
                                <button onClick={() => setModal({ type: "addCollateral", pair: p.pair })} className={BTN}>
                                  Add collateral
                                </button>
                              )}
                              {p.collateralAmount > 0n && (
                                <button onClick={() => setModal({ type: "removeCollateral", pair: p.pair })} className={BTN}>
                                  Remove
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    );
                  })}
                </>
              )}
            </table>
            </div>
          </div>
        </div>
      )}

      {/* All pairs */}
      <div className="animate-in-delay-3">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-accent">All Pairs</span>
        </div>
        <div className="technical-border bg-card">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50">
                <th className={`${TH} text-left`}>Pair</th>
                <th className={`${TH} text-right`}>Total Supplied</th>
                <th className={`${TH} text-right`}>Total Borrowed</th>
                <th className={`${TH} text-right ${XL}`}>Util</th>
                <th className={`${TH} text-right`}>Lend APY</th>
                <th className={`${TH} text-right`}>Borrow APY</th>
                <th className={`${TH} text-right`}>Max LTV</th>
                <th className={`${TH} text-right ${XL}`} title="Pair oracle exchange rate: collateral per 1 asset">Price</th>
                <th className={`${TH} text-right`}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pairsLoading ? (
                [0, 1].map((i) => (
                  <tr key={i} className="border-b border-border/50">
                    <FullRow className="px-3 py-4"><Skeleton className="h-8 w-full" /></FullRow>
                  </tr>
                ))
              ) : pairs.length === 0 ? (
                <tr>
                  <FullRow className="h-32 text-center text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">No isolated pairs in the deployment manifest</p>
                  </FullRow>
                </tr>
              ) : (
                pairs.map((p) => {
                  const util = p.utilization === undefined ? "—" : `${p.utilization.toFixed(1)}%`;
                  const price =
                    p.exchangeRate !== undefined
                      ? `1 ${p.assetSymbol} = ${formatPairPrice(collateralPerWholeAsset(p.exchangeRate, p.assetDecimals), p.collateralDecimals)} ${p.collateralSymbol}`
                      : "—";
                  return (
                  <tr key={p.name} className="border-b border-border/50 hover:bg-white/5">
                    <td className={TD}>
                      <PairName asset={p.assetSymbol} collateral={p.collateralSymbol} />
                      <div className={`${BELOW_XL} text-[10px] font-mono text-text-dim mt-1 whitespace-nowrap`} data-testid="pair-price-inline" title="Pair oracle: collateral per 1 asset">
                        Price: {price}
                      </div>
                      {/* Under the name, so it shows at every width. */}
                      {p.oracleBadData && <div className="text-[10px] font-mono text-amber-400 mt-1">borrows blocked</div>}
                    </td>
                    <td className={NUM}>{fmt(p.totalAssetAmount, p.assetDecimals)}</td>
                    <td className={NUM}>
                      <div>{fmt(p.totalBorrowAmount, p.assetDecimals)}</div>
                      <div className={`${BELOW_XL} text-[10px] text-text-dim`} data-testid="pair-util-inline">
                        {util} util
                      </div>
                    </td>
                    <td className={`${NUM} ${XL}`} data-testid="pair-util">{util}</td>
                    {/* APY = aprToApy(APR from previewAddInterest); 0 while interest is paused (spec §3.1). */}
                    <td className={`${NUM} text-emerald-400`} data-testid="pair-lend-apy">
                      {formatApy(p.lendApr && aprToApy(p.lendApr))}
                    </td>
                    <td className={`${NUM} text-amber-400`} data-testid="pair-borrow-apy">
                      {formatApy(p.borrowApr && aprToApy(p.borrowApr))}
                    </td>
                    <td className={NUM}>{p.maxLTV === undefined ? "—" : formatMaxLtvPercent(p.maxLTV)}</td>
                    <td className={`${TD} font-mono text-xs text-right ${XL}`} title="Pair oracle: collateral per 1 asset" data-testid="pair-price">
                      {price}
                    </td>
                    <td className={`${TD} text-right`}>
                      {isDeployedPair(p) ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <button onClick={() => setModal({ type: "lend", pair: p.pair })} className={BTN}>
                            Lend
                          </button>
                          <button onClick={() => setModal({ type: "borrow", pair: p.pair })} className={BTN}>
                            Borrow
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] font-mono text-text-dim uppercase whitespace-nowrap">Not deployed</span>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
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
