import { MULTICALL3_ABI } from "@/lib/abis";
import { LUMINA } from "@/lib/deployments";
import { resultAt, type CallResult, type ContractCall } from "@/hooks/chain";

/** Block a multicall was executed at (Multicall3 getBlockNumber / getCurrentBlockTimestamp). */
export interface BlockStamp {
  number: bigint;
  timestamp: bigint;
}

/**
 * Prepend these to a multicall: they run in the same eth_call as the reads after them, so the
 * stamp is the block those reads saw ("as of block N").
 */
export const STAMP_CALLS: readonly ContractCall[] = [
  { address: LUMINA.multicall3, abi: MULTICALL3_ABI, functionName: "getBlockNumber" },
  { address: LUMINA.multicall3, abi: MULTICALL3_ABI, functionName: "getCurrentBlockTimestamp" },
];

export const STAMP_OFFSET = STAMP_CALLS.length;

export function readStamp(results: readonly CallResult[] | undefined): BlockStamp | undefined {
  const number = resultAt<bigint>(results, 0);
  const timestamp = resultAt<bigint>(results, 1);
  return number !== undefined && timestamp !== undefined ? { number, timestamp } : undefined;
}
