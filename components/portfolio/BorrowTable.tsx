import { TokenIcon } from "@/components/common/TokenIcon";

interface BorrowRow {
  symbol: string;
  debt: string;
  value: string;
  apy: string;
}

export function BorrowTable({ rows, onRepay }: { rows: BorrowRow[]; onRepay: (symbol: string) => void }) {
  if (rows.length === 0) return <p className="text-slate-500 text-sm">No borrows</p>;
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-xs text-slate-400 uppercase tracking-wider border-b border-brand-border">
          <th className="pb-2">Asset</th>
          <th className="pb-2">Debt</th>
          <th className="pb-2">Value</th>
          <th className="pb-2">APY</th>
          <th className="pb-2"></th>
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
            <td className="py-3 font-mono">{r.debt}</td>
            <td className="py-3 font-mono">{r.value}</td>
            <td className="py-3 text-orange-400 font-mono">{r.apy}</td>
            <td className="py-3">
              <button onClick={() => onRepay(r.symbol)} className="text-sm text-brand-cyan hover:underline">
                Repay
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
