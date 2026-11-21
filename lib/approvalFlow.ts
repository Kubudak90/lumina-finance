/**
 * Approve → follow-up binding (Codex r1 #3). The action that follows an approval is bound to the
 * account and chain that approved, to the user's inputs at that moment, and to the exact approval
 * transaction. It runs only when THAT transaction's receipt succeeds and nothing else changed;
 * any account, chain or input change cancels it, and a retry never reuses an earlier receipt.
 */

export interface PendingFollowUp<P> {
  account: `0x${string}`;
  chainId: number;
  /** Stable key of the user's inputs (amount text + intent); any change cancels. */
  paramsKey: string;
  params: P;
  /** Hash of the approval sent for this flow; null until the wallet returns it. */
  approvalHash: `0x${string}` | null;
}

export interface FollowUpContext {
  account: `0x${string}` | undefined;
  chainId: number | undefined;
  paramsKey: string;
  receipt: { transactionHash: `0x${string}`; status: "success" | "reverted" } | undefined;
  /**
   * Hash of a transaction whose receipt could not be read or reported a failure (wagmi turns a
   * reverted receipt into an error). For the flow's own approval this ends the flow instead of
   * leaving it waiting forever (ui-usability-v1 §3.2, the step-1 receipt-error wedge).
   */
  receiptErrorHash?: `0x${string}` | undefined;
}

/**
 * What a follow-up (`onProceed`) reports when a pre-send re-check stops it: nothing was sent.
 * `reapprove` says a new approval is needed to continue (spec §3.2, "aborted: ‹reason›").
 */
export interface FollowUpAbort {
  aborted: string;
  reapprove?: boolean;
}

export function abortFollowUp(reason: string, reapprove = false): FollowUpAbort {
  return { aborted: reason, reapprove };
}

export function isFollowUpAbort(value: unknown): value is FollowUpAbort {
  return typeof value === "object" && value !== null && typeof (value as FollowUpAbort).aborted === "string";
}

export type FollowUpDecision<P> =
  | { kind: "idle" }
  | { kind: "wait" }
  | { kind: "cancel"; reason: string }
  | { kind: "proceed"; params: P };

export function startFollowUp<P>(
  account: `0x${string}`,
  chainId: number,
  paramsKey: string,
  params: P,
): PendingFollowUp<P> {
  return { account, chainId, paramsKey, params, approvalHash: null };
}

export function decideFollowUp<P>(pending: PendingFollowUp<P> | null, ctx: FollowUpContext): FollowUpDecision<P> {
  if (!pending) return { kind: "idle" };
  if (!ctx.account || ctx.account.toLowerCase() !== pending.account.toLowerCase()) {
    return { kind: "cancel", reason: "the connected account changed" };
  }
  if (ctx.chainId !== pending.chainId) return { kind: "cancel", reason: "the wallet network changed" };
  if (ctx.paramsKey !== pending.paramsKey) return { kind: "cancel", reason: "the inputs changed" };
  if (!pending.approvalHash) return { kind: "wait" };
  if (ctx.receiptErrorHash && ctx.receiptErrorHash.toLowerCase() === pending.approvalHash.toLowerCase()) {
    return { kind: "cancel", reason: "the approval failed or its receipt could not be read" };
  }
  if (!ctx.receipt || ctx.receipt.transactionHash.toLowerCase() !== pending.approvalHash.toLowerCase()) {
    return { kind: "wait" };
  }
  if (ctx.receipt.status !== "success") return { kind: "cancel", reason: "the approval reverted" };
  return { kind: "proceed", params: pending.params };
}
