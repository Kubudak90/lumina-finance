import { formatHealthFactor } from "@/lib/format";

interface HealthFactorBarProps {
  healthFactor: bigint;
}

export function HealthFactorBar({ healthFactor }: HealthFactorBarProps) {
  const isMax = healthFactor === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const hfNum = isMax ? 10 : Number(healthFactor) / 1e18;
  const percent = Math.min((hfNum / 3) * 100, 100);

  const color = hfNum >= 2 ? "bg-emerald-500" : hfNum >= 1.2 ? "bg-amber-500" : "bg-red-500";
  const textColor = hfNum >= 2 ? "text-emerald-600" : hfNum >= 1.2 ? "text-amber-600" : "text-red-600";

  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-sm text-muted-foreground font-medium">Health Factor</span>
        <span className={`text-2xl font-bold font-mono ${textColor}`}>{formatHealthFactor(healthFactor)}</span>
      </div>
      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${percent}%` }} />
      </div>
      <div className="text-xs text-muted-foreground mt-1.5">Liquidation at &lt; 1.0</div>
    </div>
  );
}
