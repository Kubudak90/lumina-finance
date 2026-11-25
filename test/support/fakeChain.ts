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
  gasPadding?: bigint;
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
  /** Block each mined receipt reports (default 1). */
  receiptBlocks: Map<string, bigint>;
  /** Receipt reads that fail (or a reverted receipt, as wagmi reports it), by hash. */
  receiptErrors: Map<string, Error>;
  /** The next send is rejected by the wallet with this error (no hash). */
  rejectNextSend: Error | null;
  /**
   * When true, a send goes through "simulating" and then "confirm in wallet", each held until the
   * test calls `stepSend()` (the hook's flags are exclusive, as useLuminaWrite's).
   */
  stepSends: boolean;
  /** While set, fresh reads (useLuminaReader, a read's refetch) wait for it before answering. */
  readGate: Promise<void> | null;
  sends: SentRequest[];
  nextHash: number;
  /**
   * When true, a write's new hash reaches the hook only on `flushWrites()`: until then the hook
   * still reports the PREVIOUS transaction's receipt (to test that a stale receipt is ignored).
   */
  deferHashUpdate: boolean;
  /** Fresh on-chain reads made through `useLuminaReader` (for assertions). */
  freshReads: ContractCall[];
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
  receiptBlocks: new Map(),
  receiptErrors: new Map(),
  rejectNextSend: null,
  stepSends: false,
  readGate: null,
  sends: [],
  nextHash: 1,
  deferHashUpdate: false,
  freshReads: [],
  data: {},
};

const pendingHashUpdates: Array<() => void> = [];
const sendSteps: Array<() => void> = [];

/** Advance the oldest held send one phase (simulating → wallet → returned); see `stepSends`. */
export function stepSend() {
  const next = sendSteps.shift();
  if (!next) throw new Error("fake chain: no send is waiting for a step");
  next();
}

/** Hold fresh reads until the returned `release()` is called (see `readGate`). */
export function holdReads(): () => void {
  let release!: () => void;
  fake.readGate = new Promise<void>((r) => (release = r));
  return () => {
    fake.readGate = null;
    release();
  };
}

/** Apply deferred hash updates (see `deferHashUpdate`). */
export function flushWrites() {
  const updates = pendingHashUpdates.splice(0);
  for (const u of updates) u();
  update(() => {});
}

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
  fake.receiptBlocks = new Map();
  fake.receiptErrors = new Map();
  fake.rejectNextSend = null;
  fake.stepSends = false;
  fake.readGate = null;
  sendSteps.length = 0;
  fake.sends = [];
  fake.nextHash = 1;
  fake.deferHashUpdate = false;
  fake.freshReads = [];
  pendingHashUpdates.length = 0;
  fake.data = {};
  fake.version += 1;
}

export function readKey(address: string | null | undefined, functionName: string) {
  return `${(address ?? "").toLowerCase()}:${functionName}`;
}

export function setRead(address: string, functionName: string, value: unknown) {
  update((f) => f.reads.set(readKey(address, functionName), value));
}

export function mine(hash: string, status: "success" | "reverted" = "success", blockNumber = 1n) {
  update((f) => {
    f.receipts.set(hash, status);
    f.receiptBlocks.set(hash, blockNumber);
  });
}

/** The receipt read of `hash` fails (wagmi also reports a reverted receipt this way). */
export function failReceipt(hash: string, error = new Error("receipt unavailable")) {
  update((f) => f.receiptErrors.set(hash, error));
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
      refetch: async () => {
        if (fake.readGate) await fake.readGate;
        return { data: fake.reads.get(key) };
      },
    };
  },
  useLuminaReadContracts: (params: { contracts?: readonly ContractCall[]; query?: { enabled?: boolean } }) => {
    useFakeVersion();
    const calls = params.contracts ?? [];
    const ready = calls.length > 0 && calls.every((c) => !!c.address) && (params.query?.enabled ?? true);
    const data = ready ? fake.multicall(calls) : undefined;
    return { data, isLoading: false, refetch: async () => ({ data }) };
  },
  useLuminaReader: () => {
    useFakeVersion();
    return useCallback(async (calls: readonly ContractCall[]) => {
      if (fake.readGate) await fake.readGate;
      fake.freshReads.push(...calls);
      const results = fake.multicall(calls);
      if (!results) throw new Error("fake chain: no answer");
      return results;
    }, []);
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
    const [sendError, setSendError] = useState<Error | null>(null);
    const [phase, setPhase] = useState<"idle" | "simulating" | "wallet">("idle");
    const send = useCallback(async (request: SentRequest) => {
      setSendError(null);
      if (fake.stepSends) {
        setPhase("simulating");
        await new Promise<void>((r) => sendSteps.push(r));
        setPhase("wallet");
        await new Promise<void>((r) => sendSteps.push(r));
        setPhase("idle");
      }
      if (fake.rejectNextSend) {
        const err = fake.rejectNextSend;
        fake.rejectNextSend = null;
        setSendError(err);
        return undefined;
      }
      fake.sends.push(request);
      const hash = hashOf(fake.nextHash++);
      if (fake.deferHashUpdate) pendingHashUpdates.push(() => setLast(hash));
      else setLast(hash);
      return hash;
    }, []);
    const status = last ? fake.receipts.get(last) : undefined;
    const receiptError = last ? (fake.receiptErrors.get(last) ?? null) : null;
    return {
      send,
      preview: null,
      isSimulating: phase === "simulating",
      isPending: phase === "wallet",
      isConfirming: phase === "idle" && !!last && status === undefined && receiptError === null,
      isSuccess: status === "success",
      hash: last,
      receipt: status && last ? { transactionHash: last, status, blockNumber: fake.receiptBlocks.get(last) ?? 1n } : undefined,
      receiptError,
      error: sendError ?? receiptError,
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

// ---------------------------------------------------------------------------------------------
// A scripted chain: answers multicalls by function name, from a mutable state
// ---------------------------------------------------------------------------------------------

export interface ChainState {
  /** getUserSnapshot by account (lowercase): [assetShares, borrowShares, collateral]. */
  snapshots: Record<string, readonly [bigint, bigint, bigint]>;
  /** toBorrowAmount(shares) → value; defaults to shares × perShare. */
  perShare: bigint;
  allowance: bigint;
  wallet: bigint;
  guardStatus: number;
  oracleBadData: boolean;
  rate: bigint;
  maxLtv: bigint;
  accounting: readonly [bigint, bigint, bigint, bigint, bigint];
  borrowLimit: bigint;
  maxRedeem: bigint;
  cleanLiquidationFee?: bigint;
  dirtyLiquidationFee?: bigint;
  protocolLiquidationFee?: bigint;
}

export function scriptedChain(state: ChainState) {
  const ok = (result: unknown): CallResult => ({ status: "success", result });
  return (calls: readonly ContractCall[]): readonly CallResult[] =>
    calls.map((c) => {
      switch (c.functionName) {
        case "getUserSnapshot": {
          const who = String(c.args?.[0] ?? "").toLowerCase();
          return ok(state.snapshots[who] ?? [0n, 0n, 0n]);
        }
        case "toBorrowAmount":
          return ok((c.args?.[0] as bigint) * state.perShare);
        case "allowance":
          return ok(state.allowance);
        case "balanceOf":
          return ok(state.wallet);
        case "borrowStatus":
          return ok([state.guardStatus, 0]);
        case "getPrices":
          return ok([state.oracleBadData, state.rate, state.rate]);
        case "maxLTV":
          return ok(state.maxLtv);
        case "getPairAccounting":
          return ok(state.accounting);
        case "borrowLimit":
          return ok(state.borrowLimit);
        case "maxRedeem":
          return ok(state.maxRedeem);
        case "cleanLiquidationFee":
          return ok(state.cleanLiquidationFee ?? 5_000n);
        case "dirtyLiquidationFee":
          return ok(state.dirtyLiquidationFee ?? 4_500n);
        case "protocolLiquidationFee":
          return ok(state.protocolLiquidationFee ?? 10_000n);
        default:
          return { status: "failure", error: new Error(`unscripted ${c.functionName}`) };
      }
    });
}
