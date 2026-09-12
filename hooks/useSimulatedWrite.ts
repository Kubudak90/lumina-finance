"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import type { Abi } from "viem";
import { describeWrite, type TxPreview } from "@/lib/txPreview";

export type SimulatedWriteRequest = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

/**
 * Validate → simulate → send → await receipt → invalidate reads.
 * Simulation runs on send (not continuously) so RPC is not hammered on every keystroke.
 */
export function useSimulatedWrite() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data });
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<Error | null>(null);

  useEffect(() => {
    if (!receipt.isSuccess) return;
    void queryClient.invalidateQueries();
  }, [receipt.isSuccess, queryClient]);

  const send = useCallback(
    async (request: SimulatedWriteRequest) => {
      if (!publicClient) {
        const err = new Error("RPC client unavailable");
        setSimulationError(err);
        throw err;
      }
      if (!address) {
        const err = new Error("Wallet not connected");
        setSimulationError(err);
        throw err;
      }
      setSimulating(true);
      setSimulationError(null);
      setPreview(describeWrite(request));
      try {
        const simulated = await publicClient.simulateContract({
          address: request.address,
          abi: request.abi,
          functionName: request.functionName,
          args: request.args as never,
          value: request.value,
          account: address,
        });
        return await write.writeContractAsync(simulated.request);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setSimulationError(error);
        return undefined;
      } finally {
        setSimulating(false);
      }
    },
    [address, publicClient, write]
  );

  return {
    send,
    preview,
    isSimulating: simulating,
    isPending: write.isPending,
    isConfirming: receipt.isLoading,
    isSuccess: receipt.isSuccess,
    hash: write.data,
    error: simulationError ?? write.error,
    reset: write.reset,
  };
}
