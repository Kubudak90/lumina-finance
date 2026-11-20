import { describe, expect, it, vi } from "vitest";
import { createPublicClient, custom, type EIP1193RequestFn } from "viem";
import { RpcChainMismatchError, chainCheckedTransport, parseChainId } from "./rpcGuard";
import { luminaChain } from "./chains";

const LUMINA_HEX = "0x4c49"; // 19529

function fakeRpc(chainIdHex: string | (() => string)) {
  const calls: string[] = [];
  const request = vi.fn(async ({ method }: { method: string }) => {
    calls.push(method);
    if (method === "eth_chainId") return typeof chainIdHex === "function" ? chainIdHex() : chainIdHex;
    if (method === "eth_blockNumber") return "0x10";
    if (method === "eth_call") return "0x";
    throw new Error(`unexpected ${method}`);
  });
  return { calls, transport: custom({ request: request as unknown as EIP1193RequestFn }) };
}

function client(transport: ReturnType<typeof fakeRpc>["transport"]) {
  return createPublicClient({ chain: luminaChain, transport: chainCheckedTransport(transport, 19529) });
}

describe("RPC chain verification (Codex #1)", () => {
  it("parses eth_chainId", () => {
    expect(parseChainId(LUMINA_HEX)).toBe(19529);
    expect(parseChainId("0x14a34")).toBe(84_532);
    expect(parseChainId("nope")).toBeNull();
  });

  it("refuses every request when the RPC reports another chain", async () => {
    const rpc = fakeRpc("0x1"); // Ethereum mainnet RPC configured by mistake
    const c = client(rpc.transport);
    await expect(c.getBlockNumber()).rejects.toThrow(RpcChainMismatchError);
    await expect(
      c.call({ to: "0x0000000000000000000000000000000000000001", data: "0x" }),
    ).rejects.toThrow(/RPC is on chain 1; expected 19529/);
    expect(rpc.calls).not.toContain("eth_blockNumber");
    expect(rpc.calls).not.toContain("eth_call");
    // eth_chainId itself still passes through, so the UI can report the mismatch.
    await expect(c.request({ method: "eth_chainId" })).resolves.toBe("0x1");
  });

  it("serves requests once eth_chainId is 19529, checking only once", async () => {
    const rpc = fakeRpc(LUMINA_HEX);
    const c = client(rpc.transport);
    await expect(c.getBlockNumber({ cacheTime: 0 })).resolves.toBe(16n);
    await c.getBlockNumber({ cacheTime: 0 });
    expect(rpc.calls.filter((m) => m === "eth_chainId")).toHaveLength(1);
    expect(rpc.calls.filter((m) => m === "eth_blockNumber")).toHaveLength(2);
  });

  it("re-checks after a failure (a mismatch is never cached as success)", async () => {
    let id = "0x1";
    const rpc = fakeRpc(() => id);
    const c = client(rpc.transport);
    await expect(c.getBlockNumber({ cacheTime: 0 })).rejects.toThrow(RpcChainMismatchError);
    id = LUMINA_HEX;
    await expect(c.getBlockNumber({ cacheTime: 0 })).resolves.toBe(16n);
  });
});
