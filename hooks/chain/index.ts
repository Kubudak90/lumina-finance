"use client";

/**
 * The only place the app touches wagmi's contract hooks (ESLint `no-restricted-imports` and
 * `lib/scope.test.ts` enforce it). Every read and write here is pinned to the Lumina chain
 * (19529), whatever chain the wallet is on (FE-03).
 */
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAccount,
  useConfig,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
  type Config,
  type ResolvedRegister,
  type UseReadContractParameters,
  type UseReadContractReturnType,
  type UseReadContractsParameters,
  type UseReadContractsReturnType,
} from "wagmi";
import { simulateContract } from "wagmi/actions";
import type { ReadContractData, ReadContractsData } from "wagmi/query";
import type { Abi, ContractFunctionArgs, ContractFunctionName } from "viem";
import { LUMINA_CHAIN_ID, isDeployed } from "@/lib/deployments";
import { NETWORK_NAME, rpcUrlFor } from "@/lib/chains";
import { executePinnedWrite, pinChainId, pinContracts, type WriteRequest } from "@/lib/chainPin";
import { describeWrite, type TxPreview } from "@/lib/txPreview";

export { LUMINA_CHAIN_ID };

/** `useReadContract`, always on the Lumina chain. */
export function useLuminaReadContract<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, "pure" | "view">,
  args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  config extends Config = ResolvedRegister["config"],
  selectData = ReadContractData<abi, functionName, args>,
>(
  parameters: UseReadContractParameters<abi, functionName, args, config, selectData>,
): UseReadContractReturnType<abi, functionName, args, selectData> {
  return useReadContract(pinChainId(parameters, LUMINA_CHAIN_ID) as typeof parameters);
}

/** `useReadContracts`, with every contract pinned to the Lumina chain. */
export function useLuminaReadContracts<
  const contracts extends readonly unknown[],
  allowFailure extends boolean = true,
  config extends Config = ResolvedRegister["config"],
  selectData = ReadContractsData<contracts, allowFailure>,
>(
  parameters: UseReadContractsParameters<contracts, allowFailure, config, selectData>,
): UseReadContractsReturnType<contracts, allowFailure, selectData> {
  const contractList = (parameters.contracts ?? []) as unknown as readonly object[];
  const pinned = { ...parameters, contracts: pinContracts(contractList, LUMINA_CHAIN_ID) };
  return useReadContracts(pinned as unknown as typeof parameters);
}

/** Public client of the Lumina chain (never the wallet's current chain). */
export function useLuminaPublicClient() {
  return usePublicClient({ chainId: LUMINA_CHAIN_ID });
}

export type ActionGate = { ready: true; reason: null } | { ready: false; reason: string };

/**
 * Whether a transaction button may be enabled: wallet connected, on the Lumina chain, RPC
 * configured, manifest deployed. Every TxButton uses this (FE-03: disable on the wrong chain).
 */
export function useActionGate(): ActionGate {
  const { isConnected, chainId } = useAccount();
  if (!rpcUrlFor(LUMINA_CHAIN_ID)) return { ready: false, reason: "RPC not configured" };
  if (!isDeployed()) return { ready: false, reason: "Not deployed yet" };
  if (!isConnected) return { ready: false, reason: "Connect wallet" };
  if (chainId !== LUMINA_CHAIN_ID) return { ready: false, reason: `Switch to ${NETWORK_NAME}` };
  return { ready: true, reason: null };
}

/**
 * Validate → simulate on the Lumina chain → send with `chainId` → await the receipt on the Lumina
 * chain → invalidate reads. Simulation runs on send, not on every keystroke.
 */
export function useLuminaWrite() {
  const { address, chainId: walletChainId } = useAccount();
  const config = useConfig();
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data, chainId: LUMINA_CHAIN_ID });
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<Error | null>(null);

  useEffect(() => {
    if (!receipt.isSuccess) return;
    void queryClient.invalidateQueries();
  }, [receipt.isSuccess, queryClient]);

  const send = useCallback(
    async (request: WriteRequest) => {
      setSimulating(true);
      setSimulationError(null);
      setPreview(describeWrite(request as Parameters<typeof describeWrite>[0]));
      try {
        let simulatorChainId: number | undefined;
        try {
          simulatorChainId = (config.getClient({ chainId: LUMINA_CHAIN_ID }).chain as { id: number }).id;
        } catch {
          simulatorChainId = undefined;
        }
        return await executePinnedWrite({
          request,
          account: address,
          expectedChainId: LUMINA_CHAIN_ID,
          walletChainId,
          simulatorChainId,
          simulate: (params) => simulateContract(config, params as never) as Promise<{ request: object }>,
          write: (params) => write.writeContractAsync(params as never),
        });
      } catch (err) {
        setSimulationError(err instanceof Error ? err : new Error(String(err)));
        return undefined;
      } finally {
        setSimulating(false);
      }
    },
    [address, walletChainId, config, write],
  );

  return {
    send,
    preview,
    isSimulating: simulating,
    isPending: write.isPending,
    isConfirming: receipt.isLoading,
    isSuccess: receipt.isSuccess,
    hash: write.data,
    error: simulationError ?? write.error ?? receipt.error,
    reset: write.reset,
  };
}

// ---------------------------------------------------------------------------------------------
// Loosely typed multicall for heterogeneous reads (results are parsed by the caller)
// ---------------------------------------------------------------------------------------------

export interface ContractCall {
  address: `0x${string}` | null | undefined;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

export type CallResult = { status: "success"; result: unknown } | { status: "failure"; error: Error };

/**
 * One pinned multicall (Multicall3 from the manifest). Disabled while any address is unknown, so a
 * template manifest never produces a read against a guessed address.
 */
export function useLuminaMulticall(
  calls: readonly ContractCall[],
  options: { enabled?: boolean; policy: { staleTime: number; refetchInterval: number | false } },
) {
  const addressesKnown = calls.length > 0 && calls.every((c) => !!c.address);
  const query = useLuminaReadContracts({
    contracts: calls as never,
    query: {
      enabled: addressesKnown && (options.enabled ?? true),
      staleTime: options.policy.staleTime,
      refetchInterval: options.policy.refetchInterval,
    },
  });
  const results = query.data as readonly CallResult[] | undefined;
  return { ...query, results };
}

/** Result of call `i`, or undefined if it failed or has not loaded. */
export function resultAt<T>(results: readonly CallResult[] | undefined, i: number): T | undefined {
  const r = results?.[i];
  return r && r.status === "success" ? (r.result as T) : undefined;
}
