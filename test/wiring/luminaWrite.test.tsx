// @vitest-environment happy-dom
/**
 * U2 review r1 #2: useLuminaWrite's flags are exclusive — `isSimulating` ends when the simulation
 * resolves, before the wallet prompt (`isPending`), so the UI can show simulating → confirm in
 * wallet. The real hook, with wagmi's write and simulate controlled by the test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ctl = vi.hoisted(() => ({
  resolveSimulate: null as null | (() => void),
  resolveWrite: null as null | ((hash: `0x${string}`) => void),
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000a11c", chainId: 19529, isConnected: true }),
  usePublicClient: () => ({ request: async () => "0x4c49" }),
  useConfig: () => ({ getClient: () => ({ chain: { id: 19529 } }) }),
  useWaitForTransactionReceipt: () => ({ data: undefined, isLoading: false, isSuccess: false, error: null }),
  useWriteContract: () => {
    const [isPending, setPending] = useState(false);
    return {
      isPending,
      data: undefined,
      error: null,
      reset: () => {},
      writeContractAsync: () => {
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
