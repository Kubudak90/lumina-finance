interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  children?: React.ReactNode;
}

export function StatCard({ label, value, subValue, children }: StatCardProps) {
  return (
    <div className="technical-border bg-card p-5 min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">{label}</div>
      {children || (
        // Never past the border: a value wider than the card wraps (the mono font is already tabular).
        <div className="text-2xl font-mono font-bold glow-text [overflow-wrap:anywhere]">{value}</div>
      )}
      {subValue && <div className="text-[10px] text-muted-foreground font-mono mt-1">{subValue}</div>}
    </div>
  );
}
