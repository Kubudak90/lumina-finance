import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { ERC20_ABI } from "@/lib/contracts";
import { maxUint256 } from "viem";

export function useTokenApproval(token: `0x${string}`, spender: `0x${string}`, owner?: `0x${string}`) {
  const allowance = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: owner ? [owner, spender] : undefined,
    query: { enabled: !!owner },
  });

  const { writeContract, data: hash, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = () => {
    writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, maxUint256],
    });
  };

  const needsApproval = (amount: bigint) => {
    if (!allowance.data) return true;
    return (allowance.data as bigint) < amount;
  };

  return { approve, needsApproval, isPending, isConfirming, isSuccess, allowance: allowance.data as bigint | undefined };
}
