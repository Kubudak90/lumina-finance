"use client";

/**
 * The only place the app touches wagmi's contract hooks (ESLint `no-restricted-imports` and
 * `lib/scope.test.ts` enforce it). Every read and write here is pinned to the Lumina chain
 * (19529), whatever chain the wallet is on (FE-03), and nothing reads, simulates or writes until
 * the configured RPC has answered eth_chainId = 19529 (Codex r1 #1).
 */
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { parseChainId } from "@/lib/rpcGuard";
import { describeWrite, type TxPreview } from "@/lib/txPreview";

export { LUMINA_CHAIN_ID };

// ---------------------------------------------------------------------------------------------
// RPC chain verification
// ---------------------------------------------------------------------------------------------

export type RpcChainStatus =
  | { status: "unconfigured"; rpcChainId: undefined }
  | { status: "checking"; rpcChainId: undefined }
  | { status: "error"; rpcChainId: undefined; error: Error }
  | { status: "mismatch"; rpcChainId: number | undefined }
  | { status: "ok"; rpcChainId: number };

/** Re-check the RPC's chain id every minute; the transport also refuses requests on a mismatch. */
const RPC_CHAIN_CHECK_MS = 60_000;

export function useRpcChainStatus(): RpcChainStatus {
  const client = usePublicClient({ chainId: LUMINA_CHAIN_ID });
  const configured = Boolean(rpcUrlFor(LUMINA_CHAIN_ID));
  const query = useQuery({
    queryKey: ["lumina", "rpc-chain-id", LUMINA_CHAIN_ID],
    queryFn: async () => parseChainId(await client!.request({ method: "eth_chainId" })),
    enabled: configured && !!client,
    staleTime: RPC_CHAIN_CHECK_MS,
    refetchInterval: RPC_CHAIN_CHECK_MS,
    retry: 1,
  });
  if (!configured) return { status: "unconfigured", rpcChainId: undefined };
  if (query.isError) return { status: "error", rpcChainId: undefined, error: query.error as Error };
  if (query.data === undefined) return { status: "checking", rpcChainId: undefined };
  if (query.data !== LUMINA_CHAIN_ID) return { status: "mismatch", rpcChainId: query.data ?? undefined };
  return { status: "ok", rpcChainId: query.data };
}

// ---------------------------------------------------------------------------------------------
// Pinned reads
// ---------------------------------------------------------------------------------------------

/** `useReadContract`, always on the Lumina chain, and only once the RPC chain is verified. */
export function useLuminaReadContract<
  const abi extends Abi | readonly unknown[],
  functionName extends ContractFunctionName<abi, "pure" | "view">,
  args extends ContractFunctionArgs<abi, "pure" | "view", functionName>,
  config extends Config = ResolvedRegister["config"],
  selectData = ReadContractData<abi, functionName, args>,
>(
  parameters: UseReadContractParameters<abi, functionName, args, config, selectData>,
): UseReadContractReturnType<abi, functionName, args, selectData> {
  const rpc = useRpcChainStatus();
  const query = { ...(parameters.query ?? {}), enabled: rpc.status === "ok" && (parameters.query?.enabled ?? true) };
  const result = useReadContract(pinChainId({ ...parameters, query }, LUMINA_CHAIN_ID) as typeof parameters);
  return gateRefetch(result, rpc.status === "ok");
}

/**
 * An explicit `.refetch()` bypasses `enabled: false`, so it is gated too: while the RPC chain is not
 * verified it reads nothing and resolves with no data (Gemini r2 m1).
 */
function gateRefetch<R extends { refetch: (...args: never[]) => Promise<unknown> }>(result: R, rpcOk: boolean): R {
  if (rpcOk) return result;
  return { ...result, refetch: (async () => ({ ...result, data: undefined, status: "error" })) as unknown as R["refetch"] };
}

/** `useReadContracts`, every contract pinned to the Lumina chain, gated on the RPC chain check. */
export function useLuminaReadContracts<
  const contracts extends readonly unknown[],
  allowFailure extends boolean = true,
  config extends Config = ResolvedRegister["config"],
  selectData = ReadContractsData<contracts, allowFailure>,
>(
  parameters: UseReadContractsParameters<contracts, allowFailure, config, selectData>,
): UseReadContractsReturnType<contracts, allowFailure, selectData> {
  const rpc = useRpcChainStatus();
  const contractList = (parameters.contracts ?? []) as unknown as readonly object[];
  const query = { ...(parameters.query ?? {}), enabled: rpc.status === "ok" && (parameters.query?.enabled ?? true) };
  const pinned = { ...parameters, query, contracts: pinContracts(contractList, LUMINA_CHAIN_ID) };
  const result = useReadContracts(pinned as unknown as typeof parameters);
  return gateRefetch(result, rpc.status === "ok");
}

/**
 * A one-off read straight from the chain (not the poll cache), for checks right before a send
 * (Gemini r2 M3). Resolves to one result per call; refuses while the RPC chain is not verified.
 */
export function useLuminaReader() {
  const client = usePublicClient({ chainId: LUMINA_CHAIN_ID });
  const rpc = useRpcChainStatus();
  const ok = rpc.status === "ok";
  return useCallback(
    async (calls: readonly ContractCall[]): Promise<readonly CallResult[]> => {
      if (!ok || !client) throw new Error("RPC chain not verified; nothing read");
      if (calls.some((c) => !c.address)) throw new Error("unknown contract address");
      const results = await client.multicall({ contracts: calls as never, allowFailure: true });
      return results as unknown as readonly CallResult[];
    },
    [client, ok],
  );
}

/** Public client of the Lumina chain (never the wallet's current chain). */
export function useLuminaPublicClient() {
  return usePublicClient({ chainId: LUMINA_CHAIN_ID });
}

// ---------------------------------------------------------------------------------------------
// Action gate
// ---------------------------------------------------------------------------------------------

export type ActionGate = { ready: true; reason: null } | { ready: false; reason: string };

/**
 * Whether a transaction button may be enabled: RPC configured and verified on chain 19529,
 * manifest deployed, wallet connected to chain 19529. Every TxButton uses this (FE-03).
 */
export function useActionGate(): ActionGate {
  const { isConnected, chainId } = useAccount();
  const rpc = useRpcChainStatus();
  if (rpc.status === "unconfigured") return { ready: false, reason: "RPC not configured" };
  if (rpc.status === "mismatch") return { ready: false, reason: "RPC on the wrong chain" };
  if (rpc.status === "error") return { ready: false, reason: "RPC unavailable" };
  if (rpc.status === "checking") return { ready: false, reason: "Checking RPC…" };
  if (!isDeployed()) return { ready: false, reason: "Not deployed yet" };
  if (!isConnected) return { ready: false, reason: "Connect wallet" };
  if (chainId !== LUMINA_CHAIN_ID) return { ready: false, reason: `Switch to ${NETWORK_NAME}` };
  return { ready: true, reason: null };
}

// ---------------------------------------------------------------------------------------------
// Pinned writes and receipts
// ---------------------------------------------------------------------------------------------

/**
 * Validate → simulate on the Lumina chain → send with `chainId` → await the receipt on the Lumina
 * chain → invalidate reads. `send` resolves to the transaction hash (undefined on failure).
 */
export function useLuminaWrite() {
  const { address, chainId: walletChainId } = useAccount();
  const config = useConfig();
  const rpc = useRpcChainStatus();
  const queryClient = useQueryClient();
  const write = useWriteContract();
  // Receipts are read from the RPC too: only while its chain is verified (Gemini r2 m1).
  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    chainId: LUMINA_CHAIN_ID,
    query: { enabled: rpc.status === "ok" && !!write.data },
  });
  const [preview, setPreview] = useState<TxPreview | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<Error | null>(null);

  useEffect(() => {
    if (!receipt.isSuccess) return;
    void queryClient.invalidateQueries();
  }, [receipt.isSuccess, queryClient]);

  const send = useCallback(
    async (request: WriteRequest): Promise<`0x${string}` | undefined> => {
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
          rpcChainId: rpc.rpcChainId,
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
    [address, walletChainId, config, write, rpc.rpcChainId],
  );

  return {
    send,
    preview,
    isSimulating: simulating,
    isPending: write.isPending,
    isConfirming: receipt.isLoading,
    isSuccess: receipt.isSuccess,
    hash: write.data,
    /** Receipt of the last transaction sent by this hook instance. */
    receipt: receipt.data
      ? { transactionHash: receipt.data.transactionHash, status: receipt.data.status }
      : undefined,
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

/**
 * Result of call `i`, or undefined if it failed or has not loaded. Callers treat undefined as
 * "unavailable", never as zero.
 */
export function resultAt<T>(results: readonly CallResult[] | undefined, i: number): T | undefined {
  const r = results?.[i];
  return r && r.status === "success" ? (r.result as T) : undefined;
}

/** bigint result of call `i`, or undefined if it failed, is missing or is not a bigint. */
export function bigintAt(results: readonly CallResult[] | undefined, i: number): bigint | undefined {
  const v = resultAt<unknown>(results, i);
  return typeof v === "bigint" ? v : undefined;
}
