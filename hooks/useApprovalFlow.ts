"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { ERC20_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { assertBoundedApproval, needsApproval } from "@/lib/approvals";
import { decideFollowUp, startFollowUp, type PendingFollowUp } from "@/lib/approvalFlow";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";

/**
 * Allowance + bounded approve + the follow-up action, bound to the approving account, chain,
 * inputs and approval tx (lib/approvalFlow.ts). Modals call `start(params, approveAmount)`; the
 * follow-up `onProceed(params)` runs with the LATEST render's closure, so it re-validates against
 * fresh polled data before sending.
 */
export function useApprovalFlow<P>(options: {
  token: `0x${string}`;
  spender: `0x${string}` | null;
  /** Key of the user's current inputs; a change while pending cancels the flow. */
  paramsKey: string;
  onProceed: (params: P) => void | Promise<void>;
}) {
  const { token, spender, paramsKey } = options;
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
  const onProceedRef = useRef(options.onProceed);
  useEffect(() => {
    onProceedRef.current = options.onProceed;
  });

  const current = allowance.data as bigint | undefined;

  const decision = decideFollowUp(pending, {
    account: address,
    chainId,
    paramsKey,
    receipt: approveTx.receipt,
  });

  // Each pending flow is resolved (cancelled or continued) exactly once.
  const resolvedRef = useRef<PendingFollowUp<P> | null>(null);
  useEffect(() => {
    if (decision.kind !== "cancel" && decision.kind !== "proceed") return;
    if (!pending || resolvedRef.current === pending) return;
    resolvedRef.current = pending;
    setPending(null);
    if (decision.kind === "cancel") {
      setCancelReason(decision.reason);
      toast.warning("Approval flow cancelled", { description: `Nothing was sent because ${decision.reason}.` });
    } else {
      void onProceedRef.current(decision.params);
    }
  }, [decision, pending]);

  const start = useCallback(
    async (params: P, approveAmount: bigint) => {
      if (!address || !spender || chainId === undefined) return;
      const amount = assertBoundedApproval(approveAmount);
      setCancelReason(null);
      const flow = startFollowUp(address, chainId, paramsKey, params);
      setPending(flow);
      const hash = await approveTx.send({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spender, amount],
      });
      // Bind the follow-up to THIS approval tx; no hash (rejected / failed) ends the flow.
      setPending((p) => (p === flow ? (hash ? { ...flow, approvalHash: hash } : null) : p));
    },
    [address, chainId, spender, paramsKey, token, approveTx],
  );

  const cancel = useCallback(() => setPending(null), []);

  return {
    allowance: current,
    refetchAllowance: async () => (await allowance.refetch()).data as bigint | undefined,
    /** True when the current allowance does not cover `required`. */
    needsApproval: (required: bigint) => needsApproval(current, required),
    start,
    cancel,
    /** A follow-up is waiting for its approval. */
    awaitingApproval: pending !== null,
    cancelReason,
    isPending: approveTx.isPending,
    isConfirming: approveTx.isConfirming,
    isSimulating: approveTx.isSimulating,
    error: approveTx.error,
  };
}
