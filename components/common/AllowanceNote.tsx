import { formatUnits } from "viem";
import { residualAllowance } from "@/lib/approvals";

function fmt(value: bigint, decimals: number) {
  return Number(formatUnits(value, decimals)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * Current allowance, what this action approves, and (for buffered repays) an ESTIMATE of what
 * stays approved afterwards, computed from the effective allowance (Codex r1 #7). The real
 * remainder is read on-chain after the transaction (PostTxAllowance).
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
  const effective = approveAmount !== undefined && approveAmount > 0n ? approveAmount : allowance;
  return (
    <div className="technical-border bg-background p-3 space-y-1 text-xs font-mono">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Allowance to {spenderLabel}</span>
        <span>{allowance === undefined ? "—" : `${fmt(allowance, decimals)} ${symbol}`}</span>
      </div>
      {approveAmount !== undefined && approveAmount > 0n && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">{buffered ? "Approves (value + 0.1% + 1 wei)" : "Approves (exact)"}</span>
          <span data-testid="approve-amount">{`${fmt(approveAmount, decimals)} ${symbol}`}</span>
        </div>
      )}
      {buffered && effective !== undefined && expectedPull !== undefined && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Residual after repay (estimated, from the effective allowance)</span>
          <span>{`≈ ${fmt(residualAllowance(effective, expectedPull), decimals)} ${symbol}`}</span>
        </div>
      )}
    </div>
  );
}
