// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ALICE, fake, hashOf, mine, resetFake, setRead } from "../support/fakeChain";
import { POOL, USDC, fake as addr } from "../support/deployment";
import { AAVE_ENTIRE_BALANCE, repayApproval } from "@/lib/approvals";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("@/hooks/useHealthFactor", () => ({ useHealthFactor: () => ({ healthFactor: undefined }) }));

import { RepayModal } from "@/components/actions/RepayModal";

// USDC is markets.core[1] → variable debt token fake(0x501) in the fixture.
const USDC_DEBT_TOKEN = addr(0x501);

beforeEach(() => {
  resetFake();
  setRead(USDC, "balanceOf", 1_000_000_000n); // wallet 1000 USDC
  setRead(USDC_DEBT_TOKEN, "balanceOf", 100_000_000n); // debt 100 USDC
  setRead(USDC, "allowance", 0n);
});
afterEach(() => cleanup());

describe("RepayModal: 'repay all' intent survives a refresh (Codex #5)", () => {
  it("debt refreshes 100 → 100.000001 after MAX: approval covers the new debt and the tx sends uint256.max", async () => {
    render(<RepayModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    // Next poll: interest accrued.
    await act(async () => setRead(USDC_DEBT_TOKEN, "balanceOf", 100_000_001n));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve USDC" })));

    expect(fake.sends[0]).toMatchObject({ functionName: "approve", args: [POOL, repayApproval(100_000_001n)] });

    // The approval mines: the chain now holds that allowance.
    await act(async () => setRead(USDC, "allowance", repayApproval(100_000_001n)));
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends).toHaveLength(2);
    expect(fake.sends[1]).toMatchObject({ functionName: "repay", address: POOL });
    expect(fake.sends[1].args).toEqual([USDC, AAVE_ENTIRE_BALANCE, 2n, ALICE]);
  });

  it("editing the amount drops the intent: a typed full amount is sent as a finite number", async () => {
    setRead(USDC, "allowance", 10n ** 12n);
    render(<RepayModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "40" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Repay USDC" })));
    expect(fake.sends.at(-1)?.args).toEqual([USDC, 40_000_000n, 2n, ALICE]);
  });

  it("partial repay: the allowance threshold is the buffered amount (Codex #4a)", async () => {
    setRead(USDC, "allowance", 40_000_000n); // exactly the raw amount: not enough
    render(<RepayModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "40" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve USDC" })));
    expect(fake.sends[0].args).toEqual([POOL, repayApproval(40_000_000n)]);
  });

  it("a wallet that cannot cover the full debt plus margin is offered a partial repay (Codex #6)", async () => {
    setRead(USDC, "balanceOf", 100_000_000n); // exactly the debt, no accrual margin
    render(<RepayModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(screen.getByTestId("partial-offer").textContent).toMatch(/Repay 100 USDC \(wallet balance\)/);
    expect((screen.getByRole("button", { name: "Approve USDC" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("re-checks the wallet after the approval: no repay if it no longer covers the debt (Codex #6)", async () => {
    render(<RepayModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve USDC" })));
    await act(async () => {
      setRead(USDC, "allowance", repayApproval(100_000_000n));
      setRead(USDC, "balanceOf", 50_000_000n); // spent elsewhere while approving
    });
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve"]);
    expect(screen.getByTestId("repay-notice").textContent).toMatch(/does not cover the full debt/);
  });

  it("shows the real allowance from the chain after the repay (Codex #7)", async () => {
    setRead(USDC, "allowance", 10n ** 12n);
    render(<RepayModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "40" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Repay USDC" })));
    await act(async () => setRead(USDC, "allowance", 959_960_000_000n));
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(screen.getByTestId("post-tx-allowance").textContent).toMatch(/959,960 USDC/);
  });
});
