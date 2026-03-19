import { TokenIcon } from "@/components/common/TokenIcon";

interface CollateralRow {
  symbol: string;
  amount: string;
  value: string;
  ltv: string;
}

export function CollateralTable({ rows }: { rows: CollateralRow[] }) {
  if (rows.length === 0) return <p className="text-slate-500 text-sm">No collateral deposited</p>;
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-brand-border">
          <th className="pb-2">Asset</th>
          <th className="pb-2">Amount</th>
          <th className="pb-2">Value</th>
          <th className="pb-2">LTV</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.symbol} className="border-b border-brand-border">
            <td className="py-3">
              <div className="flex items-center gap-2">
                <TokenIcon symbol={r.symbol} size={24} />
                {r.symbol}
              </div>
            </td>
            <td className="py-3 font-mono">{r.amount}</td>
            <td className="py-3 font-mono">{r.value}</td>
            <td className="py-3 font-mono">{r.ltv}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
