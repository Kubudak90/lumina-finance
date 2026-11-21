// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  chainId: 19529 as number | undefined,
  rpcChainIdHex: "0x4c49",
  readContractsSpy: [] as Array<{ query?: { enabled?: boolean; refetchInterval?: unknown } }>,
  receiptSpy: [] as Array<{ query?: { enabled?: boolean } }>,
  wagmiRefetchCalls: 0,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x000000000000000000000000000000000000a11c", chainId: state.chainId, isConnected: true }),
  usePublicClient: () => ({ request: async () => state.rpcChainIdHex }),
  useConfig: () => ({}),
  useReadContract: () => ({
    data: 7n,
    refetch: async () => {
      state.wagmiRefetchCalls += 1;
      return { data: 7n };
    },
  }),
  useReadContracts: (params: { query?: { enabled?: boolean; refetchInterval?: unknown } }) => {
    state.readContractsSpy.push(params);
    return { data: undefined, isLoading: false };
  },
  useWaitForTransactionReceipt: (params: { query?: { enabled?: boolean } }) => {
    state.receiptSpy.push(params);
    return {};
  },
  useWriteContract: () => ({ data: "0x1111111111111111111111111111111111111111111111111111111111111111" }),
}));
vi.mock("wagmi/actions", () => ({ simulateContract: vi.fn() }));
vi.mock("@/lib/deployments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deployments")>();
  return { ...actual, isDeployed: () => true };
});
vi.mock("@/lib/chains", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chains")>();
  return { ...actual, rpcUrlFor: () => "https://rpc.test" };
});

import { TxButton } from "@/components/common/TxButton";
import { useLuminaMulticall, useLuminaReadContract, useLuminaWrite } from "@/hooks/chain";
import { ERC20_ABI } from "@/lib/abis";
import { QUERY } from "@/lib/queryPolicy";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderButton() {
  return render(
    <TxButton onClick={() => {}} isPending={false}>
      Supply
    </TxButton>,
    { wrapper },
  );
}

beforeEach(() => {
  state.chainId = 19529;
  state.rpcChainIdHex = "0x4c49";
  state.readContractsSpy = [];
  state.receiptSpy = [];
  state.wagmiRefetchCalls = 0;
});
afterEach(() => cleanup());

describe("TxButton network lock (FE-03, Codex #14)", () => {
  it("is enabled on chain 19529 with a verified RPC", async () => {
    renderButton();
    const button = await screen.findByRole("button", { name: "Supply" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("locks while the wallet is on another chain", async () => {
    state.chainId = 1;
    renderButton();
    const button = await screen.findByRole("button", { name: /Switch to Lighter EVM devnet/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("locks while the RPC reports another chain (Codex #1)", async () => {
    state.rpcChainIdHex = "0x14a34";
    renderButton();
    const button = await screen.findByRole("button", { name: /RPC on the wrong chain/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("pinned multicall: polling and the RPC gate", () => {
  it("passes the 15 s position policy through and enables reads once the RPC is 19529", async () => {
    renderHook(
      () =>
        useLuminaMulticall([{ address: "0x0000000000000000000000000000000000000001", abi: [], functionName: "x" }], {
          policy: QUERY.user,
        }),
      { wrapper },
    );
    await waitFor(() => expect(state.readContractsSpy.at(-1)?.query?.enabled).toBe(true));
    expect(state.readContractsSpy.at(-1)?.query?.refetchInterval).toBe(15_000);
  });

  it("keeps reads disabled while the RPC reports another chain", async () => {
    state.rpcChainIdHex = "0x1";
    renderHook(
      () =>
        useLuminaMulticall([{ address: "0x0000000000000000000000000000000000000001", abi: [], functionName: "x" }], {
          policy: QUERY.user,
        }),
      { wrapper },
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(state.readContractsSpy.length).toBeGreaterThan(0);
    expect(state.readContractsSpy.every((p) => p.query?.enabled === false)).toBe(true);
  });
});

describe("receipts and explicit refetches are gated on the RPC chain (Gemini r2 m1)", () => {
  const readHook = () =>
    renderHook(
      () =>
        useLuminaReadContract({
          address: "0x0000000000000000000000000000000000000001",
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: ["0x0000000000000000000000000000000000000002"],
        }),
      { wrapper },
    );

  it("an explicit refetch reads nothing while the RPC reports another chain", async () => {
    state.rpcChainIdHex = "0x1";
    const { result } = readHook();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const r = await result.current.refetch();
    expect(r.data).toBeUndefined();
    expect(state.wagmiRefetchCalls).toBe(0);
  });

  it("an explicit refetch goes through once the RPC is verified", async () => {
    const { result } = readHook();
    await waitFor(async () => expect((await result.current.refetch()).data).toBe(7n));
    expect(state.wagmiRefetchCalls).toBeGreaterThan(0);
  });

  it("the transaction receipt is only polled while the RPC chain is verified", async () => {
    state.rpcChainIdHex = "0x1";
    renderHook(() => useLuminaWrite(), { wrapper });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(state.receiptSpy.length).toBeGreaterThan(0);
    expect(state.receiptSpy.every((p) => p.query?.enabled === false)).toBe(true);
  });

  it("…and is polled with a verified RPC", async () => {
    renderHook(() => useLuminaWrite(), { wrapper });
    await waitFor(() => expect(state.receiptSpy.at(-1)?.query?.enabled).toBe(true));
  });
});
