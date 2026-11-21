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
  isFollowUpCancel,
  staleFollowUp,
  startFollowUp,
  type FollowUpAbort,
  type FollowUpBinding,
  type FollowUpCancel,
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

/** What a follow-up returns: nothing (it sent or tried to), an abort, or a cancellation. */
export type FollowUpResult = void | FollowUpAbort | FollowUpCancel;

const same = (a: string | undefined | null, b: string | undefined | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Allowance + bounded approve + the follow-up action, bound to the approving account, chain,
 * inputs and approval tx (lib/approvalFlow.ts). Modals call `start(params, approveAmount)`; the
 * follow-up `onProceed(params)` runs with the LATEST render's closure, so it re-validates against
 * fresh polled data before sending. It may return `abortFollowUp(reason)` when a re-check stops it.
 *
 * One follow-up at a time (review U2 r1 #1): while its re-checks run (`isChecking`), a second
 * `proceed()` / `start()` is ignored and the modal's button is busy. Each follow-up is bound to the
 * account, chain and inputs it started with; `stale()` (checked by the follow-up right before the
 * wallet prompt) returns why it must not send any more, and the follow-up then returns
 * `cancelFollowUp(reason)`: nothing is sent and step 2 reads "cancelled".
 *
 * Read-only state for `TxSteps` (spec §3.2): `steps` is the flow of this modal session (null when
 * none has started). It survives the allowance refresh and a change of the inputs, account or
 * chain made while the flow is active (which cancels it: row 2 "cancelled", row 1 keeps its true
 * state); it clears on such a change while no flow is active, on the next change after a
 * cancellation, on a new `start()` and on unmount.
 * The one behaviour change: a step-1 receipt error ends the flow instead of leaving it waiting.
 */
export function useApprovalFlow<P>(options: {
  token: `0x${string}`;
  spender: `0x${string}` | null;
  /** Key of the user's current inputs; a change while pending cancels the flow. */
  paramsKey: string;
  onProceed: (params: P) => FollowUpResult | Promise<FollowUpResult>;
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
  const [isChecking, setIsChecking] = useState(false);
  const onProceedRef = useRef(options.onProceed);
  const sessionIdRef = useRef(0);
  const liveSessionRef = useRef<Session | null>(null);
  const checkingRef = useRef(false);
  /** Binding of the follow-up that is running (one at a time), for `stale()`. */
  const runningBindingRef = useRef<FollowUpBinding | null>(null);
  const liveBindingRef = useRef<FollowUpBinding>({ account: address, chainId, paramsKey });
  useEffect(() => {
    onProceedRef.current = options.onProceed;
    liveSessionRef.current = session;
    liveBindingRef.current = { account: address, chainId, paramsKey };
  });

  // A change of the inputs, account or chain clears the session unless a flow is still active;
  // a change while the flow is active is a cancellation instead (decideFollowUp while the approval
  // is pending, `follow.stale()` while step 2 re-checks), kept on screen (review U2 r1 #5).
  const latchKey = `${address?.toLowerCase() ?? ""}|${chainId ?? ""}|${paramsKey}`;
  const [seenKey, setSeenKey] = useState(latchKey);
  if (seenKey !== latchKey) {
    setSeenKey(latchKey);
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

  /**
   * Run the follow-up bound to `binding`, recording `checking` → `sent` / `aborted` / `cancelled`
   * on session `id` (if any). Re-entrant calls while one is checking are ignored (null).
   */
  const runFollowUp = useCallback(async (params: P, id: number | null, binding: FollowUpBinding): Promise<FollowUpResult | null> => {
    const mark = (step2: FollowUpState) => {
      if (id === null) return;
      setSession((s) => (s && s.id === id ? { ...s, step2 } : s));
    };
    if (checkingRef.current) return null;
    checkingRef.current = true;
    runningBindingRef.current = binding;
    setIsChecking(true);
    mark({ kind: "checking" });
    try {
      const result = await onProceedRef.current(params);
      if (isFollowUpCancel(result)) {
        mark({ kind: "cancelled", reason: result.cancelled });
        setCancelReason(result.cancelled);
        toast.warning("Transaction not sent", { description: `Nothing was sent because ${result.cancelled}.` });
      } else if (isFollowUpAbort(result)) {
        mark({ kind: "aborted", reason: result.aborted, reapprove: !!result.reapprove });
      } else {
        mark({ kind: "sent" });
      }
      return result;
    } catch (err) {
      mark({ kind: "aborted", reason: err instanceof Error ? err.message : String(err), reapprove: false });
      return undefined;
    } finally {
      checkingRef.current = false;
      runningBindingRef.current = null;
      setIsChecking(false);
    }
  }, []);

  /**
   * Why the running follow-up must not send any more (its account, chain or inputs changed), or
   * null while it is current. Follow-ups call it right before the wallet prompt.
   */
  const stale = useCallback((): string | null => {
    const bound = runningBindingRef.current;
    return bound ? staleFollowUp(bound, liveBindingRef.current) : null;
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
      const bound = { account: pending.account, chainId: pending.chainId, paramsKey: pending.paramsKey };
      void runFollowUp(decision.params, id, bound).then((r) => {
        // Another follow-up was still checking: this one did not run.
        if (r === null) setSession((s) => (s && s.id === id ? { ...s, step2: { kind: "cancelled", reason: "another check was running" } } : s));
      });
    }
  }, [decision, pending, runFollowUp]);

  const start = useCallback(
    async (params: P, approveAmount: bigint) => {
      if (!address || !spender || chainId === undefined) return;
      if (checkingRef.current) return; // a follow-up is re-checking: one flow at a time
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
    async (params: P) =>
      runFollowUp(params, liveSessionRef.current?.id ?? null, { account: address, chainId, paramsKey }),
    [runFollowUp, address, chainId, paramsKey],
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
    /** A follow-up is running its pre-send re-checks: the action button must be busy. */
    isChecking,
    stale,
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
