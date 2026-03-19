import { useReadContract } from "wagmi";
import { LENDING_POOL_ABI, ADDRESSES } from "@/lib/contracts";

export function useMarketData(asset: `0x${string}`) {
  return useReadContract({
    address: ADDRESSES.lendingPool,
    abi: LENDING_POOL_ABI,
    functionName: "getMarketData",
    args: [asset],
  });
}
