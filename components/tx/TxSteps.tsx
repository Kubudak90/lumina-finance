"use client";

import { describeTxError, type TxErrorContext } from "@/lib/txErrors";
import type { ApprovalSteps } from "@/hooks/useApprovalFlow";
import { formatAmount } from "./format";

/**
 * Two-step approve → action progress (ui-usability-v1 §3.2).
 * - Shown from the moment an approval is needed or a flow has started in this modal session; a
 *   refreshed allowance does not hide it.
 * - Row 1 "Approve ‹token› ‹amount›": the label is frozen at what was approved.
 * - Row 2 "‹Action›": waiting, checking, the action transaction's own state, or
 *   aborted / cancelled with the reason.
 * Row states: simulating → confirm in wallet → confirming → done, or failed / cancelled / aborted.
 */

export type StepRowState =
  | "not started"
  | "waiting"
  | "checking"
  | "simulating"
  | "confirm in wallet"
  | "confirming"
  | "done"
  | "failed"
  | "cancelled"
  | "aborted";

export interface ActionTxView {
  isSimulating: boolean;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error: Error | null | undefined;
}

interface Row {
  state: StepRowState;
  detail?: string;
}

const TONE: Record<StepRowState, string> = {
  "not started": "text-muted-foreground",
  waiting: "text-muted-foreground",
  checking: "text-accent",
  simulating: "text-accent",
  "confirm in wallet": "text-accent",
  confirming: "text-accent",
  done: "text-emerald-400",
  failed: "text-red-400",
  cancelled: "text-amber-400",
  aborted: "text-amber-400",
};

/** Row 1 from the flow's step-1 state. */
export function approvalRow(steps: ApprovalSteps | null, ctx: TxErrorContext): Row {
  if (!steps) return { state: "not started" };
  const s = steps.step1;
  switch (s.kind) {
    case "simulating":
      return { state: "simulating" };
    case "wallet":
      return { state: "confirm in wallet" };
    case "confirming":
      return { state: "confirming" };
    case "done":
      return { state: "done" };
    case "failed":
      return { state: "failed", detail: s.error ? describeTxError(s.error, { ...ctx, action: "approve" }) : "the approval reverted" };
  }
}

/** Row 2 from the flow's step-2 state and the action's own transaction. */
export function actionRow(steps: ApprovalSteps | null, action: ActionTxView, ctx: TxErrorContext): Row {
  if (!steps) return { state: "waiting" };
  const s = steps.step2;
  if (s.kind === "cancelled") return { state: "cancelled", detail: s.reason };
  // Once the action's transaction is under way, its own state is the truth.
  if (action.isSimulating) return { state: "simulating" };
  if (action.isPending) return { state: "confirm in wallet" };
  if (action.isConfirming) return { state: "confirming" };
  if (action.isSuccess) return { state: "done" };
  if (s.kind === "checking") return { state: "checking" };
  if (s.kind === "aborted") return { state: "aborted", detail: s.reapprove ? `${s.reason}; approve again to continue` : s.reason };
  if (s.kind === "sent" && action.error) return { state: "failed", detail: describeTxError(action.error, ctx) };
  return { state: "waiting" };
}

export function TxSteps({
  steps,
  approvalNeeded,
  approveAmount,
  symbol,
  decimals,
  actionLabel,
  action,
  ctx,
}: {
  steps: ApprovalSteps | null;
  /** An approval is needed for the current inputs. */
  approvalNeeded: boolean;
  /** What the current inputs would approve (row 1's label until a flow starts). */
  approveAmount: bigint | undefined;
  symbol: string;
  decimals: number;
  actionLabel: string;
  action: ActionTxView;
  ctx: TxErrorContext;
}) {
  if (!steps && !approvalNeeded) return null;
  const amount = steps?.approveAmount ?? approveAmount;
  const row1 = approvalRow(steps, ctx);
  const row2 = actionRow(steps, action, ctx);
  const rows: { n: number; label: string; row: Row }[] = [
    { n: 1, label: `Approve ${symbol}${amount === undefined ? "" : ` ${formatAmount(amount, decimals, 6)}`}`, row: row1 },
    { n: 2, label: actionLabel, row: row2 },
  ];
  return (
    <ol className="technical-border bg-background p-3 space-y-1.5 text-xs font-mono" data-testid="tx-steps" aria-label="Transaction steps">
      {rows.map(({ n, label, row }) => (
        <li key={n} className="flex justify-between gap-3" data-testid={`tx-step-${n}`} data-state={row.state}>
          <span>
            <span className="text-muted-foreground">{n}</span> {label}
          </span>
          <span className={`text-right ${TONE[row.state]}`}>
            {row.state}
            {row.detail ? `: ${row.detail}` : ""}
          </span>
        </li>
      ))}
      {steps === null && <li className="text-muted-foreground font-sans">Two wallet prompts: the approval, then the action.</li>}
    </ol>
  );
}
