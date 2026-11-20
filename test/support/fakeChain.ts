/**
 * A controllable stand-in for `@/hooks/chain` and `wagmi` in wiring tests. Tests mutate `fake`
 * through `update()`; every fake hook re-renders on each update. Writes are recorded in
 * `fake.sends`; a transaction "mines" when the test sets its receipt.
 */
import { useCallback, useState, useSyncExternalStore } from "react";

export type CallResult = { status: "success"; result: unknown } | { status: "failure"; error: Error };

export interface ContractCall {
  address: `0x${string}` | null | undefined;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

export interface SentRequest {
  address: `0x${string}`;
  functionName: string;
  args?: readonly unknown[];
}

export const ALICE = "0x000000000000000000000000000000000000A11c" as const;
export const BOB = "0x0000000000000000000000000000000000000B0b" as const;

interface FakeState {
  version: number;
  account: `0x${string}` | undefined;
  chainId: number | undefined;
  gate: { ready: true; reason: null } | { ready: false; reason: string };
  /** `${address.toLowerCase()}:${functionName}` → data */
  reads: Map<string, unknown>;
  /** Result for every multicall (by call); undefined = not loaded. */
  multicall: (calls: readonly ContractCall[]) => readonly CallResult[] | undefined;
  multicallSpy: Array<{ calls: readonly ContractCall[]; options: unknown }>;
  receipts: Map<string, "success" | "reverted">;
  sends: SentRequest[];
  nextHash: number;
  /** Free-form state for mocked data hooks. */
  data: Record<string, unknown>;
}

const listeners = new Set<() => void>();

export const fake: FakeState = {
  version: 0,
  account: ALICE,
  chainId: 19529,
  gate: { ready: true, reason: null },
  reads: new Map(),
  multicall: () => undefined,
  multicallSpy: [],
  receipts: new Map(),
  sends: [],
  nextHash: 1,
  data: {},
};

export function update(fn: (f: FakeState) => void) {
  fn(fake);
  fake.version += 1;
  for (const l of [...listeners]) l();
}

export function resetFake() {
  fake.account = ALICE;
  fake.chainId = 19529;
  fake.gate = { ready: true, reason: null };
  fake.reads = new Map();
  fake.multicall = () => undefined;
  fake.multicallSpy = [];
  fake.receipts = new Map();
  fake.sends = [];
  fake.nextHash = 1;
  fake.data = {};
  fake.version += 1;
}

export function readKey(address: string | null | undefined, functionName: string) {
  return `${(address ?? "").toLowerCase()}:${functionName}`;
}

export function setRead(address: string, functionName: string, value: unknown) {
  update((f) => f.reads.set(readKey(address, functionName), value));
}

export function mine(hash: string, status: "success" | "reverted" = "success") {
  update((f) => f.receipts.set(hash, status));
}

export function hashOf(n: number) {
  return `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
}

export function useFakeVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => fake.version,
    () => fake.version,
  );
}

// ---------------------------------------------------------------------------------------------
// `@/hooks/chain`
// ---------------------------------------------------------------------------------------------

function resultAt<T>(results: readonly CallResult[] | undefined, i: number): T | undefined {
  const r = results?.[i];
  return r && r.status === "success" ? (r.result as T) : undefined;
}

function bigintAt(results: readonly CallResult[] | undefined, i: number): bigint | undefined {
  const v = resultAt<unknown>(results, i);
  return typeof v === "bigint" ? v : undefined;
}

export const chainModule = {
  LUMINA_CHAIN_ID: 19529,
  resultAt,
  bigintAt,
  useRpcChainStatus: () => ({ status: "ok" as const, rpcChainId: 19529 }),
  useActionGate: () => {
    useFakeVersion();
    return fake.gate;
  },
  useLuminaPublicClient: () => undefined,
  useLuminaReadContract: (params: { address?: string; functionName: string; query?: { enabled?: boolean } }) => {
    useFakeVersion();
    const key = readKey(params.address, params.functionName);
    const enabled = params.query?.enabled ?? true;
    const data = enabled ? fake.reads.get(key) : undefined;
    return {
      data,
      isLoading: false,
      refetch: async () => ({ data: fake.reads.get(key) }),
    };
  },
  useLuminaReadContracts: () => {
    useFakeVersion();
    return { data: undefined, isLoading: false };
  },
  useLuminaMulticall: (calls: readonly ContractCall[], options: { enabled?: boolean }) => {
    useFakeVersion();
    fake.multicallSpy.push({ calls, options });
    const ready = calls.length > 0 && calls.every((c) => !!c.address) && (options.enabled ?? true);
    const results = ready ? fake.multicall(calls) : undefined;
    return { results, data: results, isLoading: false, isError: false, refetch: async () => ({ data: results }) };
  },
  useLuminaWrite: () => {
    useFakeVersion();
    const [last, setLast] = useState<`0x${string}` | undefined>();
    const send = useCallback(async (request: SentRequest) => {
      fake.sends.push(request);
      const hash = hashOf(fake.nextHash++);
      setLast(hash);
      return hash;
    }, []);
    const status = last ? fake.receipts.get(last) : undefined;
    return {
      send,
      preview: null,
      isSimulating: false,
      isPending: false,
      isConfirming: false,
      isSuccess: status === "success",
      hash: last,
      receipt: status && last ? { transactionHash: last, status } : undefined,
      error: null,
      reset: () => setLast(undefined),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// `wagmi`
// ---------------------------------------------------------------------------------------------

export const wagmiModule = {
  useAccount: () => {
    useFakeVersion();
    return { address: fake.account, chainId: fake.chainId, isConnected: !!fake.account };
  },
  useSwitchChain: () => ({ switchChain: () => {}, isPending: false }),
};
