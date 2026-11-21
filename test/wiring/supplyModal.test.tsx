// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fake, hashOf, mine, resetFake, setRead } from "../support/fakeChain";
import { POOL, USDC } from "../support/deployment";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("@/hooks/useHealthFactor", () => ({ useHealthFactor: () => ({ healthFactor: undefined }) }));

import { SupplyModal } from "@/components/actions/SupplyModal";

beforeEach(() => {
  resetFake();
  setRead(USDC, "balanceOf", 10_000_000_000n); // 10,000 USDC
  setRead(USDC, "allowance", 0n);
});
afterEach(() => cleanup());

describe("SupplyModal wiring (FE-04, Codex #14)", () => {
  it("approves exactly the amount supplied, then supplies that amount after the approval mines", async () => {
    render(<SupplyModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.5" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve USDC" })));

    expect(fake.sends).toHaveLength(1);
    expect(fake.sends[0].functionName).toBe("approve");
    expect(fake.sends[0].address.toLowerCase()).toBe(USDC.toLowerCase());
    expect(fake.sends[0].args).toEqual([POOL, 1_500_000n]); // exact: not +1, not max

    await act(async () => mine(hashOf(1)));
    // The follow-up re-reads the wallet before sending.
    await act(async () => {});
    expect(fake.sends).toHaveLength(2);
    expect(fake.sends[1]).toMatchObject({ functionName: "supply", address: POOL });
    expect(fake.sends[1].args?.[1]).toBe(1_500_000n);
  });

  it("does not approve when the allowance already covers the amount", async () => {
    setRead(USDC, "allowance", 2_000_000n);
    render(<SupplyModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.5" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Supply USDC" })));
    expect(fake.sends.map((s) => s.functionName)).toEqual(["supply"]);
  });
});
