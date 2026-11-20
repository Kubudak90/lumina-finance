"use client";

import Link from "next/link";
import { TokenIcon } from "@/components/common/TokenIcon";
import { formatPercent } from "@/lib/format";
import { formatUsd, usdValue } from "@/lib/prices";
import { useOraclePrices } from "@/hooks/useOraclePrices";
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
}

export function MarketTable({ markets }: MarketTableProps) {
  const { priceOf } = useOraclePrices();

  return (
    <Card className="p-0 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-6 text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Asset</TableHead>
            <TableHead className="px-6 text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Supply APY</TableHead>
            <TableHead className="px-6 text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Borrow APY</TableHead>
            <TableHead className="px-6 text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Total Supplied</TableHead>
            <TableHead className="px-6 text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Total Borrowed</TableHead>
            <TableHead className="px-6 text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Utilization</TableHead>
            <TableHead className="px-6 text-[10px] text-muted-foreground uppercase font-mono tracking-wider">LTV</TableHead>
            <TableHead className="px-6 text-[10px] text-muted-foreground uppercase font-mono tracking-wider">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {markets.map((m) => {
            const util = m.totalSupply > 0n ? Number((m.totalBorrow * 10000n) / m.totalSupply) / 100 : 0;
            const price = priceOf(m.asset);
            return (
              <Link key={m.symbol} href={`/markets/${m.symbol.toLowerCase()}`} className="contents">
                <TableRow className="cursor-pointer border-b border-border/50 hover:bg-white/5">
                  <TableCell className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <TokenIcon symbol={m.symbol} />
                      <div>
                        <div className="font-semibold text-foreground">{m.symbol}</div>
                        <div className="text-xs text-muted-foreground">{m.name}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-6 py-4 text-emerald-400 font-mono font-medium">{formatPercent(m.supplyRate)}</TableCell>
                  <TableCell className="px-6 py-4 text-amber-400 font-mono font-medium">{formatPercent(m.borrowRate)}</TableCell>
                  <TableCell className="px-6 py-4 font-mono text-foreground">{formatUsd(usdValue(m.totalSupply, m.decimals, price))}</TableCell>
                  <TableCell className="px-6 py-4 font-mono text-foreground">{formatUsd(usdValue(m.totalBorrow, m.decimals, price))}</TableCell>
                  <TableCell className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-border overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${util}%` }} />
                      </div>
                      <span className="text-sm text-muted-foreground font-mono">{util.toFixed(0)}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-6 py-4 font-mono text-foreground">
                    {m.config && m.config.ltv > 0 ? `${(m.config.ltv / 100).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell className="px-6 py-4">
                    {(() => {
                      // From the reserve config, not assumed.
                      const status = !m.loaded
                        ? { label: "Unknown", dot: "bg-white/30", text: "text-text-dim" }
                        : m.paused
                          ? { label: "Paused", dot: "bg-red-500", text: "text-red-400" }
                          : m.config?.isFrozen
                            ? { label: "Frozen", dot: "bg-amber-500", text: "text-amber-400" }
                            : m.config?.isActive
                              ? { label: "Active", dot: "bg-emerald-500", text: "text-emerald-400" }
                              : { label: "Inactive", dot: "bg-white/30", text: "text-text-dim" };
                      return (
                        <div className="flex items-center gap-2">
                          <span className={`inline-block h-2 w-2 rounded-full ${status.dot}`} />
                          <span className={`text-sm font-medium ${status.text}`}>{status.label}</span>
                        </div>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              </Link>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
