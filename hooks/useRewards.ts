import { useReadContract, useAccount } from "wagmi";
import { REWARDS_CONTROLLER_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";
import { QUERY } from "@/lib/queryPolicy";
import { useSimulatedWrite } from "@/hooks/useSimulatedWrite";

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

  const rewardAssets = MARKETS.flatMap((m) => [m.aToken, m.variableDebtToken]);

  const allRewards = useReadContract({
    address: ADDRESSES.rewardsController as `0x${string}`,
    abi: REWARDS_CONTROLLER_ABI,
    functionName: "getAllUserRewards",
    args: address ? [rewardAssets, address] : undefined,
    query: { enabled, ...QUERY.user },
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

  const tx = useSimulatedWrite();

  const claimAll = () => {
    if (!address) return;
    void tx.send({
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
    isPending: tx.isPending,
    isConfirming: tx.isConfirming,
    isSimulating: tx.isSimulating,
    isSuccess: tx.isSuccess,
    error: tx.error,
    isLoading: allRewards.isLoading,
  };
}
