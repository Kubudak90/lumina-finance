import { describe, expect, it, vi } from "vitest";
import {
  ChainMismatchError,
  MissingChainIdError,
  assertPinned,
  assertWalletChain,
  executePinnedWrite,
  pinChainId,
  pinContracts,
  type WriteRequest,
} from "./chainPin";
import { LUMINA_CHAIN_ID } from "./deployments";

const ACCOUNT = "0x000000000000000000000000000000000000dEaD" as const;
const REQUEST: WriteRequest = {
  address: "0x1111111111111111111111111111111111111111",
  abi: [],
  functionName: "supply",
  args: [1n],
};

/** A wallet write that refuses to run without the Lumina chainId, like wagmi + viem do. */
function strictWrite() {
  return vi.fn(async (params: { chainId?: number }) => {
    if (params.chainId === undefined) throw new Error("write attempted without chainId");
    if (params.chainId !== LUMINA_CHAIN_ID) throw new Error(`write on chain ${params.chainId}`);
    return "0xhash" as const;
  });
}

function deps(overrides: Partial<Parameters<typeof executePinnedWrite>[0]> = {}) {
  const simulate = vi.fn(async (params: WriteRequest & { account: `0x${string}`; chainId: number }) => ({
    request: { ...params, __mode: "prepared" },
  }));
  const write = strictWrite();
  return {
    simulate,
    write,
    args: {
      request: REQUEST,
      account: ACCOUNT as `0x${string}`,
      expectedChainId: LUMINA_CHAIN_ID,
      walletChainId: LUMINA_CHAIN_ID as number | undefined,
      simulatorChainId: LUMINA_CHAIN_ID as number | undefined,
      rpcChainId: LUMINA_CHAIN_ID as number | undefined,
      simulate,
      write,
      ...overrides,
    } as Parameters<typeof executePinnedWrite>[0],
  };
}

describe("pinChainId / pinContracts", () => {
  it("injects the chain id", () => {
    expect(pinChainId({ a: 1 }, LUMINA_CHAIN_ID)).toEqual({ a: 1, chainId: LUMINA_CHAIN_ID });
    expect(pinContracts([{ a: 1 }, { b: 2 }], LUMINA_CHAIN_ID).every((c) => c.chainId === LUMINA_CHAIN_ID)).toBe(true);
  });

  it("refuses to override another chain", () => {
    expect(() => pinChainId({ chainId: 1 }, LUMINA_CHAIN_ID)).toThrow(ChainMismatchError);
    expect(pinChainId({ chainId: LUMINA_CHAIN_ID }, LUMINA_CHAIN_ID).chainId).toBe(LUMINA_CHAIN_ID);
  });

  it("assertPinned fails without a chainId or with the wrong one", () => {
    expect(() => assertPinned({}, LUMINA_CHAIN_ID)).toThrow(MissingChainIdError);
    expect(() => assertPinned({ chainId: 1 }, LUMINA_CHAIN_ID)).toThrow(ChainMismatchError);
    expect(() => assertPinned({ chainId: LUMINA_CHAIN_ID }, LUMINA_CHAIN_ID)).not.toThrow();
  });

  it("assertWalletChain fails on another or unknown chain", () => {
    expect(() => assertWalletChain(LUMINA_CHAIN_ID, 1)).toThrow(ChainMismatchError);
    expect(() => assertWalletChain(LUMINA_CHAIN_ID, undefined)).toThrow(ChainMismatchError);
    expect(() => assertWalletChain(LUMINA_CHAIN_ID, LUMINA_CHAIN_ID)).not.toThrow();
  });
});

describe("executePinnedWrite", () => {
  it("simulates and sends with the Lumina chainId", async () => {
    const { args, simulate, write } = deps();
    await expect(executePinnedWrite(args)).resolves.toBe("0xhash");
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(simulate.mock.calls[0][0]).toMatchObject({ chainId: LUMINA_CHAIN_ID, account: ACCOUNT, functionName: "supply" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toMatchObject({ chainId: LUMINA_CHAIN_ID });
  });

  it("adds the chainId even when the simulated request lacks it", async () => {
    const write = strictWrite();
    const simulate = vi.fn(async () => ({ request: { address: REQUEST.address, functionName: "supply" } }));
    const { args } = deps({ simulate, write });
    await expect(executePinnedWrite(args)).resolves.toBe("0xhash");
    expect(write.mock.calls[0][0]).toMatchObject({ chainId: LUMINA_CHAIN_ID });
  });

  it("never prompts the wallet when the wallet is on another chain", async () => {
    const { args, simulate, write } = deps({ walletChainId: 1 });
    await expect(executePinnedWrite(args)).rejects.toThrow(ChainMismatchError);
    expect(simulate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses when the wallet chain is unknown or the wallet is disconnected", async () => {
    const unknown = deps({ walletChainId: undefined });
    await expect(executePinnedWrite(unknown.args)).rejects.toThrow(ChainMismatchError);
    expect(unknown.write).not.toHaveBeenCalled();
    const disconnected = deps({ account: undefined });
    await expect(executePinnedWrite(disconnected.args)).rejects.toThrow(/not connected/);
    expect(disconnected.write).not.toHaveBeenCalled();
  });

  it("refuses when the simulating client is on another chain", async () => {
    const { args, simulate, write } = deps({ simulatorChainId: 1 });
    await expect(executePinnedWrite(args)).rejects.toThrow(ChainMismatchError);
    expect(simulate).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses when the RPC's eth_chainId is not the Lumina chain (Codex #1)", async () => {
    for (const rpcChainId of [1, undefined]) {
      const { args, simulate, write } = deps({ rpcChainId });
      await expect(executePinnedWrite(args)).rejects.toThrow(ChainMismatchError);
      expect(simulate).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    }
  });

  it("refuses a request that names another chain", async () => {
    const { args, write } = deps({ request: { ...REQUEST, chainId: 1 } });
    await expect(executePinnedWrite(args)).rejects.toThrow(ChainMismatchError);
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses a simulation result for another chain", async () => {
    const simulate = vi.fn(async () => ({ request: { chainId: 1 } }));
    const { args, write } = deps({ simulate });
    await expect(executePinnedWrite(args)).rejects.toThrow(ChainMismatchError);
    expect(write).not.toHaveBeenCalled();
  });

  it("the strict write mock itself fails without a chainId (sanity check of the test)", async () => {
    await expect(strictWrite()({})).rejects.toThrow(/without chainId/);
    await expect(strictWrite()({ chainId: 1 })).rejects.toThrow(/chain 1/);
  });

  it("adds gas = estimate + gasPadding when gasPadding is set (F2 pair liquidate gas rule)", async () => {
    const estimateGas = vi.fn<(params: WriteRequest & { account: `0x${string}`; chainId: number }) => Promise<bigint>>(async () => 250_000n);
    const { args, write } = deps({
      request: { ...REQUEST, functionName: "liquidate", gasPadding: 1_100_000n },
      estimateGas,
    });
    await expect(executePinnedWrite(args)).resolves.toBe("0xhash");
    expect(estimateGas).toHaveBeenCalledTimes(1);
    expect(estimateGas.mock.calls[0][0]).toMatchObject({ chainId: LUMINA_CHAIN_ID, account: ACCOUNT, functionName: "liquidate" });
    expect(write.mock.calls[0][0]).toMatchObject({ chainId: LUMINA_CHAIN_ID, gas: 1_350_000n });
  });

  it("does not estimate or override gas when gasPadding is unset", async () => {
    const estimateGas = vi.fn<(params: WriteRequest & { account: `0x${string}`; chainId: number }) => Promise<bigint>>(async () => 250_000n);
    const { args, write } = deps({ estimateGas });
    await expect(executePinnedWrite(args)).resolves.toBe("0xhash");
    expect(estimateGas).not.toHaveBeenCalled();
    expect((write.mock.calls[0][0] as { gas?: bigint }).gas).toBeUndefined();
  });
});
