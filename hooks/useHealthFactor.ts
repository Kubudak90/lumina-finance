import { useReadContract, useAccount } from "wagmi";
import { POOL_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";

/**
 * Returns the user's health factor from Pool.getUserAccountData(user).
 *
 * In Aave V3, getUserAccountData returns a tuple:
 *   (totalCollateralBase, totalDebtBase, availableBorrowsBase,
 *    currentLiquidationThreshold, ltv, healthFactor)
 *
 * healthFactor is in WAD (1e18). A value of type(uint256).max means no debt.
 */
export function useHealthFactor() {
  const { address } = useAccount();

  const result = useReadContract({
    address: ADDRESSES.pool as `0x${string}`,
    abi: POOL_ABI,
    functionName: "getUserAccountData",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  // getUserAccountData returns 6 values; viem may return as array or object
  let healthFactor: bigint | undefined;
  if (result.data) {
    const d = result.data as unknown;
    if (Array.isArray(d)) {
      healthFactor = d[5] as bigint;
    } else if (typeof d === "object" && d !== null && "healthFactor" in d) {
      healthFactor = (d as { healthFactor: bigint }).healthFactor;
    }
  }

  return {
    healthFactor,
    isLoading: result.isLoading,
  };
}
