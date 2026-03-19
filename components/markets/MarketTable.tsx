"use client";

import Link from "next/link";
import { TokenIcon } from "@/components/common/TokenIcon";
import { formatUsd, formatPercent } from "@/lib/format";
import type { MarketInfo } from "@/hooks/useAllMarkets";

interface MarketTableProps {
  markets: MarketInfo[];
}

export function MarketTable({ markets }: MarketTableProps) {
  return (
    <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm">
      <table className="w-full">
        <thead>
          <tr className="border-b border-brand-border text-left text-xs text-text-secondary uppercase tracking-wider">
            <th className="px-6 py-3 font-medium">Asset</th>
            <th className="px-6 py-3 font-medium">Supply APY</th>
            <th className="px-6 py-3 font-medium">Borrow APY</th>
            <th className="px-6 py-3 font-medium">Total Supplied</th>
            <th className="px-6 py-3 font-medium">Total Borrowed</th>
            <th className="px-6 py-3 font-medium">Utilization</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((m) => {
            const util = m.totalSupply > 0n ? Number((m.totalBorrow * 10000n) / m.totalSupply) / 100 : 0;
            return (
              <Link key={m.symbol} href={`/markets/${m.symbol.toLowerCase()}`} className="contents">
                <tr className="border-b border-brand-border hover:bg-gray-50 cursor-pointer transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <TokenIcon symbol={m.symbol} />
                      <div>
                        <div className="font-semibold text-text-primary">{m.symbol}</div>
                        <div className="text-xs text-text-secondary">{m.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-success font-mono font-medium">{formatPercent(m.supplyRate)}</td>
                  <td className="px-6 py-4 text-warning font-mono font-medium">{formatPercent(m.borrowRate)}</td>
                  <td className="px-6 py-4 font-mono text-text-primary">{formatUsd(m.totalSupply)}</td>
                  <td className="px-6 py-4 font-mono text-text-primary">{formatUsd(m.totalBorrow)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-accent rounded-full" style={{ width: `${util}%` }} />
                      </div>
                      <span className="text-sm text-text-secondary font-mono">{util.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              </Link>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
