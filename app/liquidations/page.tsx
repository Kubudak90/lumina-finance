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
      <div className="animate-in">
        <h1 className="text-3xl font-bold mb-1 text-text-primary">Liquidation Opportunities</h1>
        <p className="text-text-secondary">Positions below health factor 1.0 can be liquidated</p>
      </div>

      <div className="bg-white border border-brand-border rounded-xl overflow-hidden shadow-sm animate-in-delay-1">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-text-secondary uppercase tracking-wider border-b border-brand-border">
              <th className="px-6 py-3 font-medium">Borrower</th>
              <th className="px-6 py-3 font-medium">Debt</th>
              <th className="px-6 py-3 font-medium">Collateral</th>
              <th className="px-6 py-3 font-medium">Health Factor</th>
              <th className="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {opportunities.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-text-secondary">
                  No liquidation opportunities at this time
                </td>
              </tr>
            ) : (
              opportunities.map((o) => (
                <tr key={o.borrower} className="border-b border-brand-border hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 font-mono text-sm text-text-primary">{truncateAddress(o.borrower)}</td>
                  <td className="px-6 py-4 font-mono text-text-primary">{o.debt}</td>
                  <td className="px-6 py-4 font-mono text-text-primary">{o.collateral}</td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-danger bg-danger/10 px-2 py-0.5 rounded-md text-sm font-medium">{o.healthFactor}</span>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setSelected(o)}
                      className="text-sm bg-danger/10 text-danger px-3 py-1.5 rounded-lg hover:bg-danger/20 font-medium transition-colors"
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
