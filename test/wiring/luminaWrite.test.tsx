// @vitest-environment happy-dom
/**
 * U2 review r1 #2: useLuminaWrite's flags are exclusive — `isSimulating` ends when the simulation
 * resolves, before the wallet prompt (`isPending`), so the UI can show simulating → confirm in
 * wallet. U4 review r1 #4: a send whose component unmounted while it simulated opens no wallet
 * prompt. The real hook, with wagmi's write and simulate controlled by the test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ctl = vi.hoisted(() => ({
  resolveSimulate: null as null | (() => void),
  resolveWrite: null as null | ((hash: `0x${string}`) => void),
  /** writeContractAsync calls: each one is a wallet prompt. */
  walletPrompts: 0,
  lastWriteParams: null as null | Record<string, unknown>,
  estimatedGas: 240_000n,
  estimateCalls: 0,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000a11c", chainId: 19529, isConnected: true }),
  usePublicClient: () => ({
    request: async () => "0x4c49",
    estimateContractGas: async () => {
      ctl.estimateCalls += 1;
      return ctl.estimatedGas;
    },
  }),
  useConfig: () => ({ getClient: () => ({ chain: { id: 19529 } }) }),
  useWaitForTransactionReceipt: () => ({ data: undefined, isLoading: false, isSuccess: false, error: null }),
  useWriteContract: () => {
    const [isPending, setPending] = useState(false);
    return {
      isPending,
      data: undefined,
      error: null,
      reset: () => {},
      writeContractAsync: (params: Record<string, unknown>) => {
        ctl.walletPrompts += 1;
        ctl.lastWriteParams = params;
        setPending(true);
        return new Promise<`0x${string}`>((resolve) => {
          ctl.resolveWrite = (hash) => {
            setPending(false);
            resolve(hash);
          };
        });
      },
    };
  },
}));
vi.mock("wagmi/actions", () => ({
  simulateContract: () =>
    new Promise((resolve) => {
      ctl.resolveSimulate = () => resolve({ request: { address: "0x0000000000000000000000000000000000000001", abi: [], functionName: "supply", args: [] } });
    }),
}));
vi.mock("@/lib/deployments", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/deployments")>()), isDeployed: () => true }));
vi.mock("@/lib/chains", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/chains")>()), rpcUrlFor: () => "https://rpc.test" }));

import { useLuminaWrite, useRpcChainStatus } from "@/hooks/chain";
import { renderClosable } from "../support/closable";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => cleanup());

describe("useLuminaWrite: simulating → confirm in wallet are exclusive", () => {
  it("isSimulating clears when the simulation resolves, before the wallet prompt", async () => {
    const { result } = renderHook(() => ({ write: useLuminaWrite(), rpc: useRpcChainStatus() }), { wrapper });
    await waitFor(() => expect(result.current.rpc.status).toBe("ok"));

    let sent!: Promise<unknown>;
    act(() => {
      sent = result.current.write.send({ address: "0x0000000000000000000000000000000000000001", abi: [], functionName: "supply", args: [] });
    });
    await waitFor(() => expect(ctl.resolveSimulate).not.toBeNull());
    expect(result.current.write.isSimulating).toBe(true);
    expect(result.current.write.isPending).toBe(false);

    await act(async () => ctl.resolveSimulate!());
    await waitFor(() => expect(result.current.write.isPending).toBe(true));
    expect(result.current.write.isSimulating).toBe(false); // the wallet is asking now

    const hash = `0x${"ab".repeat(32)}` as const;
    await act(async () => ctl.resolveWrite!(hash));
    await expect(sent).resolves.toBe(hash);
    expect(result.current.write.isPending).toBe(false);
    expect(result.current.write.isSimulating).toBe(false);
  });
});

describe("useLuminaWrite: no wallet prompt once its component is gone (U4 review r1 #4)", () => {
  it("the dialog closes while it simulates; the simulation resolves right after the closing commit → no writeContractAsync", async () => {
    ctl.resolveSimulate = null;
    ctl.walletPrompts = 0;
    const live: { write?: ReturnType<typeof useLuminaWrite>; rpc?: string } = {};
    function Sender() {
      live.write = useLuminaWrite();
      live.rpc = useRpcChainStatus().status;
      return null;
    }
    // The simulation resolves inside the closing commit (layout phase), before passive cleanups run.
    const dialog = renderClosable(wrapper({ children: <Sender /> }), () => ctl.resolveSimulate?.());
    await waitFor(() => expect(live.rpc).toBe("ok"));

    let sent!: Promise<unknown>;
    act(() => {
      sent = live.write!.send({ address: "0x0000000000000000000000000000000000000001", abi: [], functionName: "supply", args: [] });
    });
    await waitFor(() => expect(ctl.resolveSimulate).not.toBeNull());
    expect(live.write!.isSimulating).toBe(true);

    await dialog.closeOutsideAct();

    expect(dialog.probe.passiveRanBeforeCommitMicrotasks).toBe(false); // the window was open
    expect(ctl.walletPrompts).toBe(0); // no wallet prompt for the closed dialog
    await expect(sent).resolves.toBeUndefined(); // and the send ends: no hash
  });
});

describe("useLuminaWrite: F2 gas padding for pair liquidate", () => {
  it("sends gas = estimate + 1,000,000 + 100,000 when gasPadding is specified", async () => {
    ctl.resolveSimulate = null;
    ctl.resolveWrite = null;
    ctl.lastWriteParams = null;
    ctl.estimateCalls = 0;
    ctl.estimatedGas = 240_000n;

    const { result } = renderHook(() => ({ write: useLuminaWrite(), rpc: useRpcChainStatus() }), { wrapper });
    await waitFor(() => expect(result.current.rpc.status).toBe("ok"));

    let sent!: Promise<unknown>;
    act(() => {
      sent = result.current.write.send({
        address: "0x0000000000000000000000000000000000000001",
        abi: [],
        functionName: "liquidate",
        args: [],
        gasPadding: 1_100_000n,
      });
    });
    await waitFor(() => expect(ctl.resolveSimulate).not.toBeNull());
    await act(async () => ctl.resolveSimulate!());
    await waitFor(() => expect(ctl.lastWriteParams).not.toBeNull());
    expect(ctl.estimateCalls).toBe(1);
    expect((ctl.lastWriteParams as Record<string, unknown> | null)?.gas).toBe(240_000n + 1_100_000n);

    const hash = `0x${"cd".repeat(32)}` as const;
    await act(async () => ctl.resolveWrite!(hash));
    await expect(sent).resolves.toBe(hash);
  });
});
