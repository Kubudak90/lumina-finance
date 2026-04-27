import { useEffect } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { VARIABLE_DEBT_TOKEN_ABI } from "@/lib/abis";

const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * Aave V3 credit-delegation flow.
 *
 * Looping borrows on behalf of the user, so the user must first approve the
 * Looping contract to draw debt against their account via the variableDebtToken's
 * approveDelegation(delegatee, amount) function.
 */
export function useDebtDelegation(
  variableDebtToken: `0x${string}` | undefined,
  delegatee: `0x${string}`,
  owner?: `0x${string}`,
) {
  const allowance = useReadContract({
    address: variableDebtToken,
    abi: VARIABLE_DEBT_TOKEN_ABI,
    functionName: "borrowAllowance",
    args: owner ? [owner, delegatee] : undefined,
    query: { enabled: !!owner && !!variableDebtToken, refetchInterval: 15_000 },
  });

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) allowance.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const approve = (amount: bigint = MAX_UINT256) => {
    if (!variableDebtToken) return;
    writeContract({
      address: variableDebtToken,
      abi: VARIABLE_DEBT_TOKEN_ABI,
      functionName: "approveDelegation",
      args: [delegatee, amount],
    });
  };

  const needsApproval = (amount: bigint) => {
    const a = allowance.data as bigint | undefined;
    if (a === undefined) return true;
    return a < amount;
  };

  return {
    approve,
    needsApproval,
    isPending,
    isConfirming,
    isSuccess,
    error,
    allowance: allowance.data as bigint | undefined,
  };
}
