import { formatUnits } from "viem";
import { residualAllowance } from "@/lib/approvals";

function fmt(value: bigint, decimals: number) {
  return Number(formatUnits(value, decimals)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * Shows the current allowance and, for buffered repay approvals, the most that can remain
 * approved after the repay (residual allowance, spec §3.3).
 */
export function AllowanceNote({
  symbol,
  decimals,
  spenderLabel,
  allowance,
  approveAmount,
  expectedPull,
  buffered,
}: {
  symbol: string;
  decimals: number;
  spenderLabel: string;
  allowance: bigint | undefined;
  /** Amount this action approves (if it needs an approval). */
  approveAmount?: bigint;
  /** What the action is expected to transfer (current value). */
  expectedPull?: bigint;
  buffered?: boolean;
}) {
  return (
    <div className="technical-border bg-background p-3 space-y-1 text-xs font-mono">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Allowance to {spenderLabel}</span>
        <span>{allowance === undefined ? "—" : `${fmt(allowance, decimals)} ${symbol}`}</span>
      </div>
      {approveAmount !== undefined && approveAmount > 0n && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">{buffered ? "Approves (value + 0.1% + 1 wei)" : "Approves (exact)"}</span>
          <span>{`${fmt(approveAmount, decimals)} ${symbol}`}</span>
        </div>
      )}
      {buffered && approveAmount !== undefined && expectedPull !== undefined && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Max residual allowance after repay</span>
          <span>{`${fmt(residualAllowance(approveAmount, expectedPull), decimals)} ${symbol}`}</span>
        </div>
      )}
    </div>
  );
}
