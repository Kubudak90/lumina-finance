import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { POOL_ABI } from "@/lib/abis";
import { ADDRESSES } from "@/lib/contracts";

export interface EModeCategoryData {
  ltv: number;                    // basis points (e.g. 9700 = 97%)
  liquidationThreshold: number;   // basis points
  liquidationBonus: number;       // basis points (e.g. 10200 = 102%)
  priceSource: `0x${string}`;
  label: string;
}

/**
 * Hook for Aave V3 Efficiency Mode (E-Mode).
 *
 * - Pool.getUserEMode(user) -> returns the user's current E-Mode category ID
 * - Pool.setUserEMode(categoryId) -> tx to change E-Mode
 * - Pool.getEModeCategoryData(categoryId) -> returns the category config
 *
 * Category 0 = no E-Mode (default).
 */
export function useEMode() {
  const { address } = useAccount();

  // Get user's current E-Mode category
  const userEMode = useReadContract({
    address: ADDRESSES.pool as `0x${string}`,
    abi: POOL_ABI,
    functionName: "getUserEMode",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  let currentCategoryId = 0;
  try {
    if (userEMode.data !== undefined && userEMode.data !== null) {
      currentCategoryId = Number(userEMode.data);
    }
  } catch {
    currentCategoryId = 0;
  }

  // Get E-Mode category data for the user's current category
  const categoryResult = useReadContract({
    address: ADDRESSES.pool as `0x${string}`,
    abi: POOL_ABI,
    functionName: "getEModeCategoryData",
    args: [currentCategoryId],
    query: { enabled: currentCategoryId > 0, refetchInterval: 60_000 },
  });

  let categoryData: EModeCategoryData | undefined;
  try {
    const raw = categoryResult.data;
    if (raw && currentCategoryId > 0) {
      const d = raw as Record<string, unknown>;
      if (d.ltv !== undefined) {
        categoryData = {
          ltv: Number(d.ltv),
          liquidationThreshold: Number(d.liquidationThreshold),
          liquidationBonus: Number(d.liquidationBonus),
          priceSource: (d.priceSource as `0x${string}`) ?? "0x0000000000000000000000000000000000000000",
          label: (d.label as string) ?? "",
        };
      } else if (Array.isArray(raw)) {
        categoryData = {
          ltv: Number(raw[0]),
          liquidationThreshold: Number(raw[1]),
          liquidationBonus: Number(raw[2]),
          priceSource: (raw[3] as `0x${string}`) ?? "0x0000000000000000000000000000000000000000",
          label: (raw[4] as string) ?? "",
        };
      }
    }
  } catch {
    categoryData = undefined;
  }

  // Set user E-Mode
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setEMode = (categoryId: number) => {
    writeContract({
      address: ADDRESSES.pool as `0x${string}`,
      abi: POOL_ABI,
      functionName: "setUserEMode",
      args: [categoryId],
    });
  };

  return {
    currentCategoryId,
    categoryData,
    setEMode,
    isPending,
    isConfirming,
    isSuccess,
    error,
    isLoading: userEMode.isLoading,
  };
}
