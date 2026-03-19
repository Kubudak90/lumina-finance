interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
}

export function StatCard({ label, value, subValue }: StatCardProps) {
  return (
    <div className="bg-brand-card border border-brand-border rounded-xl p-4">
      <div className="text-xs text-cyan-300 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
      {subValue && <div className="text-sm text-slate-400 mt-1">{subValue}</div>}
    </div>
  );
}
