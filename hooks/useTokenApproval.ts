import { useReadContract } from "wagmi";
import { ERC20_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { useSimulatedWrite } from "@/hooks/useSimulatedWrite";

export function useTokenApproval(token: `0x${string}`, spender: `0x${string}`, owner?: `0x${string}`) {
  const allowance = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner ? [owner, spender] : undefined,
    query: { enabled: !!owner, ...QUERY.user },
  });

  const tx = useSimulatedWrite();

  const approve = (amount: bigint) => {
    void tx.send({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    });
  };

  const needsApproval = (amount: bigint) => {
    if (!allowance.data) return true;
    return (allowance.data as bigint) < amount;
  };

  return {
    approve,
    needsApproval,
    isPending: tx.isPending,
    isConfirming: tx.isConfirming,
    isSimulating: tx.isSimulating,
    isSuccess: tx.isSuccess,
    error: tx.error,
    allowance: allowance.data as bigint | undefined,
  };
}
