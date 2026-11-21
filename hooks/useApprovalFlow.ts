"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { ERC20_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { assertBoundedApproval, needsApproval } from "@/lib/approvals";
import {
  decideFollowUp,
  isFollowUpAbort,
  startFollowUp,
  type FollowUpAbort,
  type PendingFollowUp,
} from "@/lib/approvalFlow";
import { describeWrite, type TxPreview } from "@/lib/txPreview";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";

/**
 * The one place an ERC-20 approval is built (lib/scope.test.ts: no free-standing approve anywhere
 * else). Used for the send and for the declarative preview in a modal's Details.
 */
function approveRequest(token: `0x${string}`, spender: `0x${string}`, amount: bigint) {
  return { address: token, abi: ERC20_ABI, functionName: "approve", args: [spender, amount] } as const;
}

/** The raw approve call a flow would send, for a preview before anything is sent (spec §3.2). */
export function describeApprove(token: `0x${string}`, spender: `0x${string}`, amount: bigint): TxPreview {
  return describeWrite(approveRequest(token, spender, amount));
}

/** Step 1 (the approval) as the wallet and the chain report it. */
export type ApprovalTxState =
  | { kind: "simulating" }
  | { kind: "wallet" }
  | { kind: "confirming"; hash: `0x${string}` }
  | { kind: "done"; hash: `0x${string}` }
  | { kind: "failed"; error: Error | null; hash?: `0x${string}` };

/**
 * Step 2 (the follow-up) as far as the flow knows it. Once `sent`, the action's own transaction
 * state (the modal's write) says where it is.
 */
export type FollowUpState =
  | { kind: "waiting" }
  | { kind: "checking" }
  | { kind: "sent" }
  | { kind: "aborted"; reason: string; reapprove: boolean }
  | { kind: "cancelled"; reason: string };

/** One approval flow of this modal session, read-only (spec §3.2 `TxSteps`). */
export interface ApprovalSteps {
  /** What step 1 approves, frozen when the flow started. */
  approveAmount: bigint;
  approvalHash: `0x${string}` | null;
  step1: ApprovalTxState;
  step2: FollowUpState;
}

interface Session {
  id: number;
  approveAmount: bigint;
  approvalHash: `0x${string}` | null;
  /** The wallet returned no hash (rejected or failed before broadcast). */
  noHash: boolean;
  step2: FollowUpState;
}

const same = (a: string | undefined | null, b: string | undefined | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Allowance + bounded approve + the follow-up action, bound to the approving account, chain,
 * inputs and approval tx (lib/approvalFlow.ts). Modals call `start(params, approveAmount)`; the
 * follow-up `onProceed(params)` runs with the LATEST render's closure, so it re-validates against
 * fresh polled data before sending. It may return `abortFollowUp(reason)` when a re-check stops it.
 *
 * Read-only state for `TxSteps` (spec §3.2): `steps` is the flow of this modal session (null when
 * none has started). It survives the allowance refresh and an edit made while the flow is active
 * (which cancels it: row 2 "cancelled", row 1 keeps its true state); it clears on an edit while no
 * flow is active, on the next edit after a cancellation, on a new `start()` and on unmount.
 * The one behaviour change: a step-1 receipt error ends the flow instead of leaving it waiting.
 */
export function useApprovalFlow<P>(options: {
  token: `0x${string}`;
  spender: `0x${string}` | null;
  /** Key of the user's current inputs; a change while pending cancels the flow. */
  paramsKey: string;
  onProceed: (params: P) => void | FollowUpAbort | Promise<void | FollowUpAbort>;
  /** The modal's own action transaction is in flight (keeps the session through an edit). */
  actionBusy?: boolean;
}) {
  const { token, spender, paramsKey } = options;
  const actionBusy = options.actionBusy ?? false;
  const { address, chainId } = useAccount();
  const allowance = useLuminaReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && spender ? [address, spender] : undefined,
    query: { enabled: !!address && !!spender, ...QUERY.user },
  });
  const approveTx = useLuminaWrite();
  const [pending, setPending] = useState<PendingFollowUp<P> | null>(null);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const onProceedRef = useRef(options.onProceed);
  const sessionIdRef = useRef(0);
  const liveSessionRef = useRef<Session | null>(null);
  useEffect(() => {
    onProceedRef.current = options.onProceed;
    liveSessionRef.current = session;
  });

  // An edit (paramsKey change) clears the session unless a flow is still active; an edit while
  // the approval is pending is a cancellation instead (decideFollowUp below), kept on screen.
  const [seenKey, setSeenKey] = useState(paramsKey);
  if (seenKey !== paramsKey) {
    setSeenKey(paramsKey);
    const active =
      session !== null &&
      (pending !== null || session.step2.kind === "checking" || (session.step2.kind === "sent" && actionBusy));
    if (session && !active) setSession(null);
  }

  const current = allowance.data as bigint | undefined;

  const decision = decideFollowUp(pending, {
    account: address,
    chainId,
    paramsKey,
    receipt: approveTx.receipt,
    receiptErrorHash: approveTx.receiptError && approveTx.hash ? approveTx.hash : undefined,
  });

  /** Run the follow-up, recording `checking` → `sent` / `aborted` on session `id` (if any). */
  const runFollowUp = useCallback(async (params: P, id: number | null) => {
    const mark = (step2: FollowUpState) => {
      if (id === null) return;
      setSession((s) => (s && s.id === id ? { ...s, step2 } : s));
    };
    mark({ kind: "checking" });
    try {
      const result = await onProceedRef.current(params);
      mark(isFollowUpAbort(result) ? { kind: "aborted", reason: result.aborted, reapprove: !!result.reapprove } : { kind: "sent" });
      return result;
    } catch (err) {
      mark({ kind: "aborted", reason: err instanceof Error ? err.message : String(err), reapprove: false });
      return undefined;
    }
  }, []);

  // Each pending flow is resolved (cancelled or continued) exactly once.
  const resolvedRef = useRef<PendingFollowUp<P> | null>(null);
  useEffect(() => {
    if (decision.kind !== "cancel" && decision.kind !== "proceed") return;
    if (!pending || resolvedRef.current === pending) return;
    resolvedRef.current = pending;
    setPending(null);
    const id = liveSessionRef.current?.id ?? null;
    if (decision.kind === "cancel") {
      setCancelReason(decision.reason);
      setSession((s) => (s && s.id === id ? { ...s, step2: { kind: "cancelled", reason: decision.reason } } : s));
      toast.warning("Approval flow cancelled", { description: `Nothing was sent because ${decision.reason}.` });
    } else {
      void runFollowUp(decision.params, id);
    }
  }, [decision, pending, runFollowUp]);

  const start = useCallback(
    async (params: P, approveAmount: bigint) => {
      if (!address || !spender || chainId === undefined) return;
      const amount = assertBoundedApproval(approveAmount);
      setCancelReason(null);
      const flow = startFollowUp(address, chainId, paramsKey, params);
      const id = ++sessionIdRef.current;
      setSession({ id, approveAmount: amount, approvalHash: null, noHash: false, step2: { kind: "waiting" } });
      setPending(flow);
      const hash = await approveTx.send(approveRequest(token, spender, amount));
      // Bind the follow-up to THIS approval tx; no hash (rejected / failed) ends the flow.
      setPending((p) => (p === flow ? (hash ? { ...flow, approvalHash: hash } : null) : p));
      setSession((s) =>
        s && s.id === id
          ? hash
            ? { ...s, approvalHash: hash }
            : { ...s, noHash: true, step2: { kind: "cancelled", reason: "the approval was not sent" } }
          : s,
      );
    },
    [address, chainId, spender, paramsKey, token, approveTx],
  );

  /**
   * Run the follow-up directly (the allowance already covers it). Inside a flow session the
   * re-check and its outcome show in `steps`; otherwise it just runs.
   */
  const proceed = useCallback(
    async (params: P) => runFollowUp(params, liveSessionRef.current?.id ?? null),
    [runFollowUp],
  );

  const cancel = useCallback(() => setPending(null), []);

  const steps: ApprovalSteps | null = session
    ? {
        approveAmount: session.approveAmount,
        approvalHash: session.approvalHash,
        step1: step1State(session, approveTx),
        step2: session.step2,
      }
    : null;

  return {
    allowance: current,
    refetchAllowance: async () => (await allowance.refetch()).data as bigint | undefined,
    /** True when the current allowance does not cover `required`. */
    needsApproval: (required: bigint) => needsApproval(current, required),
    start,
    proceed,
    cancel,
    /** A follow-up is waiting for its approval. */
    awaitingApproval: pending !== null,
    cancelReason,
    /** The approval flow of this modal session (null when none started), for `TxSteps`. */
    steps,
    /** Preview of the approve call this flow would send for `amount` (Details, before sending). */
    describeApprove: (amount: bigint): TxPreview | null => (spender ? describeApprove(token, spender, amount) : null),
    isPending: approveTx.isPending,
    isConfirming: approveTx.isConfirming,
    isSimulating: approveTx.isSimulating,
    error: approveTx.error,
  };
}

function step1State(
  s: Session,
  tx: {
    hash: `0x${string}` | undefined;
    receipt: { transactionHash: `0x${string}`; status: "success" | "reverted" } | undefined;
    receiptError: Error | null;
    isSimulating: boolean;
    isPending: boolean;
    error: Error | null;
  },
): ApprovalTxState {
  if (s.approvalHash) {
    const hash = s.approvalHash;
    if (tx.receipt && same(tx.receipt.transactionHash, hash)) {
      return tx.receipt.status === "success" ? { kind: "done", hash } : { kind: "failed", error: null, hash };
    }
    if (tx.receiptError && same(tx.hash, hash)) return { kind: "failed", error: tx.receiptError, hash };
    return { kind: "confirming", hash };
  }
  if (s.noHash) return { kind: "failed", error: tx.error };
  if (tx.isPending) return { kind: "wallet" };
  return { kind: "simulating" };
}
