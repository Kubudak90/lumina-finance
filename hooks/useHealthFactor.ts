import { useReadContract, useAccount } from "wagmi";
import { LENDING_POOL_ABI, ADDRESSES } from "@/lib/contracts";

export function useHealthFactor() {
  const { address } = useAccount();

  const result = useReadContract({
    address: ADDRESSES.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "getHealthFactor",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  return {
    healthFactor: result.data as bigint | undefined,
    isLoading: result.isLoading,
  };
}
