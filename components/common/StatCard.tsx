interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
}

export function StatCard({ label, value, subValue }: StatCardProps) {
  return (
    <div className="bg-white border border-brand-border rounded-xl p-5 shadow-sm relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-accent/20 rounded-l-xl" />
      <div className="text-xs text-text-secondary uppercase tracking-wider font-medium mb-2">{label}</div>
      <div className="text-2xl font-bold font-mono text-text-primary">{value}</div>
      {subValue && <div className="text-sm text-text-secondary mt-1">{subValue}</div>}
    </div>
  );
}
