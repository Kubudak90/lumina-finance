"use client";

import { useAccount } from "wagmi";
import { ERC20_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";
import { useLuminaReadContract } from "@/hooks/chain";

/** The connected wallet's balance of `token`, polled; `fetchNow` re-reads it from the chain. */
export function useWalletBalance(token: `0x${string}` | undefined) {
  const { address } = useAccount();
  const read = useLuminaReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!token, ...QUERY.user },
  });
  return {
    value: read.data as bigint | undefined,
    fetchNow: async () => (await read.refetch()).data as bigint | undefined,
  };
}
