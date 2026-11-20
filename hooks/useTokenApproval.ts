"use client";

import { ERC20_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { assertBoundedApproval, needsApproval as allowanceShort } from "@/lib/approvals";
import { useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";

/**
 * ERC-20 allowance of `owner` to `spender` on the Lumina chain, and a bounded approve. There is no
 * default or "max" amount: callers pass the exact (or repay-buffered) value from lib/approvals.
 */
export function useTokenApproval(
  token: `0x${string}`,
  spender: `0x${string}` | null,
  owner?: `0x${string}`,
) {
  const allowance = useLuminaReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    query: { enabled: !!owner && !!spender, ...QUERY.user },
  });

  const tx = useLuminaWrite();

  const approve = (amount: bigint) => {
    if (!spender) return;
    void tx.send({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, assertBoundedApproval(amount)],
    });
  };

  const current = allowance.data as bigint | undefined;

  return {
    approve,
    /** True when the current allowance does not cover `required`. */
    needsApproval: (required: bigint) => allowanceShort(current, required),
    isPending: tx.isPending,
    isConfirming: tx.isConfirming,
    isSimulating: tx.isSimulating,
    isSuccess: tx.isSuccess,
    error: tx.error,
    allowance: current,
    refetch: allowance.refetch,
  };
}
