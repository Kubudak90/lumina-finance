"use client";

import Link from "next/link";
import { TokenIcon } from "@/components/common/TokenIcon";
import { formatUsd, formatPercent } from "@/lib/format";
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
  return (
    <Card className="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-6">Asset</TableHead>
            <TableHead className="px-6">Supply APY</TableHead>
            <TableHead className="px-6">Borrow APY</TableHead>
            <TableHead className="px-6">Total Supplied</TableHead>
            <TableHead className="px-6">Total Borrowed</TableHead>
            <TableHead className="px-6">Utilization</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {markets.map((m) => {
            const util = m.totalSupply > 0n ? Number((m.totalBorrow * 10000n) / m.totalSupply) / 100 : 0;
            return (
              <Link key={m.symbol} href={`/markets/${m.symbol.toLowerCase()}`} className="contents">
                <TableRow className="cursor-pointer">
                  <TableCell className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <TokenIcon symbol={m.symbol} />
                      <div>
                        <div className="font-semibold text-foreground">{m.symbol}</div>
                        <div className="text-xs text-muted-foreground">{m.name}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-6 py-4 text-success font-mono font-medium">{formatPercent(m.supplyRate)}</TableCell>
                  <TableCell className="px-6 py-4 text-warning font-mono font-medium">{formatPercent(m.borrowRate)}</TableCell>
                  <TableCell className="px-6 py-4 font-mono text-foreground">{formatUsd(m.totalSupply)}</TableCell>
                  <TableCell className="px-6 py-4 font-mono text-foreground">{formatUsd(m.totalBorrow)}</TableCell>
                  <TableCell className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-brand-accent rounded-full" style={{ width: `${util}%` }} />
                      </div>
                      <span className="text-sm text-muted-foreground font-mono">{util.toFixed(0)}%</span>
                    </div>
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
