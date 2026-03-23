import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { REWARDS_CONTROLLER_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";

/**
 * Hook for Aave V3 Rewards (incentives).
 *
 * - RewardsController.getAllUserRewards(assets[], user) -> lists all reward tokens + amounts
 * - RewardsController.getUserRewards(assets[], user, reward) -> amount for a specific reward token
 * - RewardsController.claimAllRewards(assets[], to) -> claims everything
 *
 * The `assets` parameter should be the aToken and debtToken addresses that
 * the user holds. For simplicity, we pass all market underlying assets here;
 * in practice you may want to pass aToken/debtToken addresses.
 */
export function useRewards() {
  const { address } = useAccount();
  const enabled = !!address && !!ADDRESSES.rewardsController;

  // RewardsController expects aToken + debtToken addresses, not underlying
  const rewardAssets = MARKETS.flatMap((m) => [m.aToken, m.variableDebtToken]);

  // Fetch all unclaimed rewards for user
  const allRewards = useReadContract({
    address: ADDRESSES.rewardsController as `0x${string}`,
    abi: REWARDS_CONTROLLER_ABI,
    functionName: "getAllUserRewards",
    args: address ? [rewardAssets, address] : undefined,
    query: { enabled, refetchInterval: 30_000 },
  });

  const rawAllRewards = allRewards.data as
    | readonly [readonly string[], readonly bigint[]]
    | undefined;

  const rewards =
    rawAllRewards
      ? rawAllRewards[0].map((rewardToken, i) => ({
          rewardToken: rewardToken as `0x${string}`,
          unclaimedAmount: rawAllRewards[1][i],
        }))
      : [];

  const totalUnclaimed = rewards.reduce((sum, r) => sum + r.unclaimedAmount, 0n);

  // Claim all rewards
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const claimAll = () => {
    if (!address) return;
    writeContract({
      address: ADDRESSES.rewardsController as `0x${string}`,
      abi: REWARDS_CONTROLLER_ABI,
      functionName: "claimAllRewards",
      args: [rewardAssets, address],
    });
  };

  return {
    rewards,
    totalUnclaimed,
    claimAll,
    isPending,
    isConfirming,
    isSuccess,
    error,
    isLoading: allRewards.isLoading,
  };
}
