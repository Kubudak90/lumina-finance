import { formatHealth, formatMaxLtvPercent, type HealthStatus, type IsolatedLtvResult } from "@/lib/risk";

/**
 * Risk gauge. Status, text and fill all come from `formatHealth` (ui-usability-v1 spec §3.1):
 * - default (`healthFactor`): core HF on a 0–3 scale, liquidation below 1.0;
 * - `variant="ltv"`: isolated LTV on 0–100% of the pair's maxLTV, liquidation above maxLTV.
 */
type HealthFactorBarProps =
  | { variant?: "hf"; healthFactor: bigint | undefined }
  | { variant: "ltv"; ltv: IsolatedLtvResult | undefined; maxLTV: bigint | undefined };

const BAR: Record<HealthStatus, string> = {
  safe: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  liquidatable: "bg-destructive",
  unavailable: "bg-muted-foreground",
};

const TEXT: Record<HealthStatus, string> = {
  safe: "text-success-strong",
  warning: "text-warning-strong",
  danger: "text-danger-strong",
  liquidatable: "text-destructive-strong",
  unavailable: "text-muted-foreground",
};

export function HealthFactorBar(props: HealthFactorBarProps) {
  const ltv = props.variant === "ltv";
  const health = ltv
    ? formatHealth({ kind: "ltv", ltv: props.ltv, maxLTV: props.maxLTV })
    : formatHealth({ kind: "hf", healthFactor: props.healthFactor });
  const title = ltv ? "LTV" : "Health Factor";
  const footer = ltv
    ? props.maxLTV === undefined
      ? "Max LTV unavailable"
      : `Liquidation above ${formatMaxLtvPercent(props.maxLTV)} LTV`
    : "Liquidation at < 1.0";

  return (
    <div>
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className={`text-2xl font-bold font-mono glow-text ${TEXT[health.status]}`}>{health.value}</span>
      </div>
      <div
        className="meter-track h-2.5 bg-gauge-track overflow-hidden"
        role="meter"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={health.gauge}
        aria-valuetext={`${health.value}, ${health.statusLabel}`}
      >
        <div className={`meter-bar h-full ${BAR[health.status]} transition-all duration-500`} style={{ width: `${health.gauge}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground font-mono mt-1.5">
        {footer} · {health.statusLabel}
      </div>
    </div>
  );
}
