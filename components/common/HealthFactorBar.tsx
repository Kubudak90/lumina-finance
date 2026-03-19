import { formatHealthFactor } from "@/lib/format";

interface HealthFactorBarProps {
  healthFactor: bigint;
}

export function HealthFactorBar({ healthFactor }: HealthFactorBarProps) {
  const isMax = healthFactor === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const hfNum = isMax ? 10 : Number(healthFactor) / 1e18;
  const percent = Math.min((hfNum / 3) * 100, 100);

  const color = hfNum >= 2 ? "bg-success" : hfNum >= 1.2 ? "bg-warning" : "bg-danger";
  const label = hfNum >= 2 ? "Healthy" : hfNum >= 1.2 ? "Caution" : "Danger";

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-text-secondary">Health Factor</span>
        <span className="font-mono font-bold text-text-primary">{formatHealthFactor(healthFactor)}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${percent}%` }} />
      </div>
      <div className="text-xs text-text-secondary mt-1">{label}</div>
    </div>
  );
}
