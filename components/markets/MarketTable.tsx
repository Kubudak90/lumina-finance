"use client";

import Link from "next/link";
import { FixedTokenIcon } from "@/components/overview/FixedTokenIcon";
import { formatApy } from "@/lib/format";
import { coreApy } from "@/lib/risk";
import { formatUsd, usdValue } from "@/lib/prices";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { marketStatus } from "@/lib/marketStatus";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import type { MarketInfo } from "@/hooks/useAllMarkets";

interface MarketTableProps {
  markets: MarketInfo[];
  /** Opens a market (the page passes router.push). When given, a click anywhere on a row opens it. */
  onOpenMarket?: (href: string) => void;
}

/**
 * A row click outside the asset link opens that row's market. The link itself handles its own
 * click (and is the keyboard path); a click that ends a text selection, or lands on a button, is
 * not a navigation.
 */
function rowClick(href: string, open: ((href: string) => void) | undefined) {
  return (event: React.MouseEvent<HTMLTableRowElement>) => {
    if (!open) return;
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    if (window.getSelection()?.toString()) return;
    open(href);
  };
}

export function MarketTable({ markets, onOpenMarket }: MarketTableProps) {
  const { priceOf } = useOraclePrices();

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-2.5 xl:px-6 h-auto py-3 whitespace-normal align-bottom text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Asset</TableHead>
            <TableHead className="px-2.5 xl:px-6 h-auto py-3 whitespace-normal align-bottom text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Supply APY</TableHead>
            <TableHead className="px-2.5 xl:px-6 h-auto py-3 whitespace-normal align-bottom text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Borrow APY</TableHead>
            <TableHead className="px-2.5 xl:px-6 h-auto py-3 whitespace-normal align-bottom text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Total Supplied</TableHead>
            <TableHead className="px-2.5 xl:px-6 h-auto py-3 whitespace-normal align-bottom text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Total Borrowed</TableHead>
            <TableHead className="px-2.5 xl:px-6 h-auto py-3 whitespace-normal align-bottom text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Utilization</TableHead>
            <TableHead className="px-2.5 xl:px-6 h-auto py-3 whitespace-normal align-bottom text-[10px] text-muted-foreground uppercase font-mono tracking-wider">LTV</TableHead>
            <TableHead className="px-2.5 xl:px-6 h-auto py-3 whitespace-normal align-bottom text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {markets.map((m) => {
            const util =
              m.totalSupply === undefined || m.totalBorrow === undefined
                ? undefined
                : m.totalSupply > 0n
                  ? Number((m.totalBorrow * 10000n) / m.totalSupply) / 100
                  : 0;
            const price = priceOf(m.asset);
            const href = `/markets/${m.symbol.toLowerCase()}`;
            return (
              // A real link in the asset cell (keyboard path, open-in-new-tab); the rest of the row
              // opens the market on click. No <a> around the <tr> (valid HTML).
              <TableRow
                key={m.symbol}
                className={`border-b border-border/50 hover:bg-white/5 ${onOpenMarket ? "cursor-pointer" : ""}`}
                onClick={rowClick(href, onOpenMarket)}
                data-testid="market-row"
              >
                  <TableCell className="px-2.5 xl:px-6 py-4 whitespace-normal">
                    <Link
                      href={href}
                      className="inline-flex items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {/* Fixed-size box: a bare <img> counts as 0 px when the column is sized (overlap). */}
                      <FixedTokenIcon symbol={m.symbol} size={32} />
                      <div>
                        <div className="font-semibold text-foreground">{m.symbol}</div>
                        <div className="text-xs text-muted-foreground">{m.name}</div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="px-2.5 xl:px-6 py-4 text-emerald-400 font-mono font-medium">{formatApy(coreApy(m.supplyRate))}</TableCell>
                  <TableCell className="px-2.5 xl:px-6 py-4 text-amber-400 font-mono font-medium">{formatApy(coreApy(m.borrowRate))}</TableCell>
                  <TableCell className="px-2.5 xl:px-6 py-4 font-mono text-foreground">{formatUsd(usdValue(m.totalSupply, m.decimals, price))}</TableCell>
                  <TableCell className="px-2.5 xl:px-6 py-4 font-mono text-foreground">{formatUsd(usdValue(m.totalBorrow, m.decimals, price))}</TableCell>
                  <TableCell className="px-2.5 xl:px-6 py-4">
                    <div className="flex items-center gap-2">
                      {/* Decorative bar from xl; the percentage next to it shows at every width. */}
                      <div className="hidden xl:block w-16 h-1.5 bg-border overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${util ?? 0}%` }} />
                      </div>
                      <span className="text-sm text-muted-foreground font-mono">{util === undefined ? "—" : `${util.toFixed(0)}%`}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-2.5 xl:px-6 py-4 font-mono text-foreground">
                    {m.config && m.config.ltv > 0 ? `${(m.config.ltv / 100).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell className="px-2.5 xl:px-6 py-4">
                    {(() => {
                      // From the reserve config, not assumed.
                      const label = marketStatus(m);
                      const tone = {
                        Unknown: { dot: "bg-white/30", text: "text-text-dim" },
                        Paused: { dot: "bg-red-500", text: "text-red-400" },
                        Frozen: { dot: "bg-amber-500", text: "text-amber-400" },
                        Active: { dot: "bg-emerald-500", text: "text-emerald-400" },
                        Inactive: { dot: "bg-white/30", text: "text-text-dim" },
                      }[label];
                      const status = { label, ...tone };
                      return (
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 rounded-full ${status.dot}`} />
                          <span className={`text-sm font-medium ${status.text}`}>{status.label}</span>
                        </div>
                      );
                    })()}
                  </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
