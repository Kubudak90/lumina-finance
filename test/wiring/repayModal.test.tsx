// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ALICE, fake, hashOf, mine, resetFake, setRead } from "../support/fakeChain";
import { POOL, USDC, WETH, fake as addr } from "../support/deployment";
import { AAVE_ENTIRE_BALANCE, repayApproval } from "@/lib/approvals";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("@/hooks/useHealthFactor", () => ({ useHealthFactor: () => ({ healthFactor: undefined }) }));

import { RepayModal } from "@/components/actions/RepayModal";

// markets.core[0] = WETH, [1] = USDC → variable debt tokens fake(0x500), fake(0x501) in the fixture.
const WETH_DEBT_TOKEN = addr(0x500);
const USDC_DEBT_TOKEN = addr(0x501);

beforeEach(() => {
  resetFake();
  setRead(USDC, "balanceOf", 1_000_000_000n); // wallet 1000 USDC
  setRead(USDC_DEBT_TOKEN, "balanceOf", 100_000_000n); // debt 100 USDC
  setRead(USDC, "allowance", 0n);
});
afterEach(() => cleanup());

describe("RepayModal: interest accrues while the approval mines (Gemini r2 C1)", () => {
  it("1 WETH at 5% APR: debt grows by 2 s of interest before the follow-up → the repay still goes out with uint256.max", async () => {
    setRead(WETH, "balanceOf", 2n * 10n ** 18n);
    setRead(WETH_DEBT_TOKEN, "balanceOf", 10n ** 18n);
    setRead(WETH, "allowance", 0n);
    render(<RepayModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve WETH" })));
    expect(fake.sends[0].args).toEqual([POOL, repayApproval(10n ** 18n)]);

    // While the approval mines: two seconds of 5% APR interest, and the allowance lands.
    await act(async () => {
      setRead(WETH_DEBT_TOKEN, "balanceOf", 1_000_000_003_170_979_198n);
      setRead(WETH, "allowance", repayApproval(10n ** 18n));
    });
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends).toHaveLength(2);
    expect(fake.sends[1]).toMatchObject({ functionName: "repay", args: [WETH, AAVE_ENTIRE_BALANCE, 2n, ALICE] });
  });

  it("still refuses when the allowance cannot cover the headroom over the accrued debt", async () => {
    setRead(WETH, "balanceOf", 2n * 10n ** 18n);
    setRead(WETH_DEBT_TOKEN, "balanceOf", 10n ** 18n);
    setRead(WETH, "allowance", 0n);
    render(<RepayModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve WETH" })));
    await act(async () => {
      setRead(WETH_DEBT_TOKEN, "balanceOf", 1_000_600_000_000_000_000n); // +0.06%: past the headroom
      setRead(WETH, "allowance", repayApproval(10n ** 18n));
    });
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.map((x) => x.functionName)).toEqual(["approve"]);
    expect(screen.getByTestId("repay-notice").textContent).toMatch(/approve again/);
  });
});

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
