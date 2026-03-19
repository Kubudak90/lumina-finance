"use client";

import { useState } from "react";
import { truncateAddress } from "@/lib/format";
import { LiquidateModal } from "@/components/actions/LiquidateModal";

interface LiquidationOpportunity {
  borrower: `0x${string}`;
  debt: string;
  collateral: string;
  healthFactor: string;
  debtAsset: `0x${string}`;
  collateralAdapter: `0x${string}`;
  maxDebt: string;
  debtSymbol: string;
}

export default function LiquidationsPage() {
  const [selected, setSelected] = useState<LiquidationOpportunity | null>(null);

  // MVP: placeholder — in production, fetch from events/indexer
  const opportunities: LiquidationOpportunity[] = [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Liquidation Opportunities</h1>
        <p className="text-slate-400">Positions below health factor 1.0 can be liquidated</p>
      </div>

      <div className="bg-brand-card border border-brand-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-brand-border">
              <th className="px-6 py-3">Borrower</th>
              <th className="px-6 py-3">Debt</th>
              <th className="px-6 py-3">Collateral</th>
              <th className="px-6 py-3">Health Factor</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                  No liquidation opportunities at this time
                </td>
              </tr>
            ) : (
              opportunities.map((o) => (
                <tr key={o.borrower} className="border-b border-brand-border hover:bg-white/[0.02]">
                  <td className="px-6 py-4 font-mono text-sm">{truncateAddress(o.borrower)}</td>
                  <td className="px-6 py-4 font-mono">{o.debt}</td>
                  <td className="px-6 py-4 font-mono">{o.collateral}</td>
                  <td className="px-6 py-4 font-mono text-danger">{o.healthFactor}</td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setSelected(o)}
                      className="text-sm bg-danger/20 text-danger px-3 py-1 rounded-lg hover:bg-danger/30"
                    >
                      Liquidate
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <LiquidateModal
          borrower={selected.borrower}
          debtAsset={selected.debtAsset}
          debtSymbol={selected.debtSymbol}
          collateralAdapter={selected.collateralAdapter}
          maxDebt={selected.maxDebt}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
