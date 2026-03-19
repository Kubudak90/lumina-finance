import { TokenIcon } from "@/components/common/TokenIcon";

interface CollateralRow {
  symbol: string;
  amount: string;
  value: string;
  ltv: string;
}

export function CollateralTable({ rows }: { rows: CollateralRow[] }) {
  if (rows.length === 0) return <p className="text-text-secondary text-sm">No collateral deposited</p>;
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-xs text-text-secondary uppercase tracking-wider border-b border-brand-border">
          <th className="pb-2 font-medium">Asset</th>
          <th className="pb-2 font-medium">Amount</th>
          <th className="pb-2 font-medium">Value</th>
          <th className="pb-2 font-medium">LTV</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.symbol} className="border-b border-brand-border hover:bg-gray-50 transition-colors">
            <td className="py-3">
              <div className="flex items-center gap-2">
                <TokenIcon symbol={r.symbol} size={24} />
                <span className="font-medium text-text-primary">{r.symbol}</span>
              </div>
            </td>
            <td className="py-3 font-mono text-text-primary">{r.amount}</td>
            <td className="py-3 font-mono text-text-primary">{r.value}</td>
            <td className="py-3 font-mono text-text-primary">{r.ltv}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
