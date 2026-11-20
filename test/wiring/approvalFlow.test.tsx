// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ALICE, BOB, fake, hashOf, mine, resetFake, update } from "../support/fakeChain";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);

import { useApprovalFlow } from "@/hooks/useApprovalFlow";

const TOKEN = "0x00000000000000000000000000000000000000c1" as const;
const SPENDER = "0x0000000000000000000000000000000000000100" as const;

function setup(paramsKey = "100") {
  const onProceed = vi.fn();
  const hook = renderHook(
    ({ key }) => useApprovalFlow<{ amount: bigint }>({ token: TOKEN, spender: SPENDER, paramsKey: key, onProceed }),
    { initialProps: { key: paramsKey } },
  );
  return { hook, onProceed };
}

beforeEach(() => resetFake());
afterEach(() => cleanup());

describe("approval → follow-up binding in the hook (Codex #3)", () => {
  it("continues only after the receipt of its own approval", async () => {
    const { hook, onProceed } = setup();
    await act(async () => hook.result.current.start({ amount: 100n }, 100n));
    expect(fake.sends).toHaveLength(1);
    expect(fake.sends[0]).toMatchObject({ functionName: "approve", args: [SPENDER, 100n] });
    expect(onProceed).not.toHaveBeenCalled();
    await act(async () => mine(hashOf(1)));
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(onProceed).toHaveBeenCalledWith({ amount: 100n });
  });

  it("switching accounts while the approval is pending → no follow-up wallet request", async () => {
    const { hook, onProceed } = setup();
    await act(async () => hook.result.current.start({ amount: 100n }, 100n));
    await act(async () => update((f) => (f.account = BOB)));
    await act(async () => mine(hashOf(1)));
    expect(onProceed).not.toHaveBeenCalled();
    expect(fake.sends).toHaveLength(1); // only the approval
    expect(hook.result.current.cancelReason).toMatch(/account/);
  });

  it("switching chains while the approval is pending → no follow-up", async () => {
    const { hook, onProceed } = setup();
    await act(async () => hook.result.current.start({ amount: 100n }, 100n));
    await act(async () => update((f) => (f.chainId = 1)));
    await act(async () => update((f) => (f.chainId = 19529)));
    await act(async () => mine(hashOf(1)));
    expect(onProceed).not.toHaveBeenCalled();
    expect(hook.result.current.cancelReason).toMatch(/network/);
  });

  it("changing the inputs while pending cancels the flow", async () => {
    const { hook, onProceed } = setup("100");
    await act(async () => hook.result.current.start({ amount: 100n }, 100n));
    hook.rerender({ key: "500" });
    await act(async () => mine(hashOf(1)));
    expect(onProceed).not.toHaveBeenCalled();
    expect(hook.result.current.cancelReason).toMatch(/inputs/);
  });

  it("a retry never continues on the earlier approval's receipt", async () => {
    const { hook, onProceed } = setup();
    await act(async () => hook.result.current.start({ amount: 100n }, 100n));
    await act(async () => mine(hashOf(1)));
    expect(onProceed).toHaveBeenCalledTimes(1);
    // Second round: new approval hash 2; hash 1 is already mined but must not count.
    await act(async () => hook.result.current.start({ amount: 100n }, 100n));
    expect(onProceed).toHaveBeenCalledTimes(1);
    await act(async () => mine(hashOf(2)));
    expect(onProceed).toHaveBeenCalledTimes(2);
  });

  it("a reverted approval cancels", async () => {
    const { hook, onProceed } = setup();
    await act(async () => hook.result.current.start({ amount: 100n }, 100n));
    await act(async () => mine(hashOf(1), "reverted"));
    expect(onProceed).not.toHaveBeenCalled();
    expect(fake.account).toBe(ALICE);
  });

  it("refuses an unbounded approval", async () => {
    const { hook } = setup();
    await expect(hook.result.current.start({ amount: 1n }, (1n << 256n) - 1n)).rejects.toThrow(/refusing approval/);
    expect(fake.sends).toHaveLength(0);
  });
});
