import { TokenIcon } from "@/components/common/TokenIcon";

interface SupplyRow {
  symbol: string;
  balance: string;
  value: string;
  apy: string;
}

export function SupplyTable({ rows, onWithdraw }: { rows: SupplyRow[]; onWithdraw: (symbol: string) => void }) {
  if (rows.length === 0) return <p className="text-text-secondary text-sm">No supplies yet</p>;
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-xs text-text-secondary uppercase tracking-wider border-b border-brand-border">
          <th className="pb-2 font-medium">Asset</th>
          <th className="pb-2 font-medium">Balance</th>
          <th className="pb-2 font-medium">Value</th>
          <th className="pb-2 font-medium">APY</th>
          <th className="pb-2"></th>
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
            <td className="py-3 font-mono text-text-primary">{r.balance}</td>
            <td className="py-3 font-mono text-text-primary">{r.value}</td>
            <td className="py-3 text-success font-mono font-medium">{r.apy}</td>
            <td className="py-3">
              <button onClick={() => onWithdraw(r.symbol)} className="text-sm text-brand-accent hover:underline font-medium">
                Withdraw
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
