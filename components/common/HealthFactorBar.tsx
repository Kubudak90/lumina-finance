import { formatHealthFactor } from "@/lib/format";

interface HealthFactorBarProps {
  healthFactor: bigint;
}

export function HealthFactorBar({ healthFactor }: HealthFactorBarProps) {
  const isMax = healthFactor === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const hfNum = isMax ? 10 : Number(healthFactor) / 1e18;
  const percent = Math.min((hfNum / 3) * 100, 100);

  const color = hfNum >= 2 ? "bg-emerald-500" : hfNum >= 1.2 ? "bg-amber-500" : "bg-red-500";
  const textColor = hfNum >= 2 ? "text-emerald-400" : hfNum >= 1.2 ? "text-amber-400" : "text-red-400";

  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Health Factor</span>
        <span className={`text-2xl font-bold font-mono glow-text ${textColor}`}>{formatHealthFactor(healthFactor)}</span>
      </div>
      <div className="h-2.5 bg-border overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${percent}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground font-mono mt-1.5">Liquidation at &lt; 1.0</div>
    </div>
  );
}
