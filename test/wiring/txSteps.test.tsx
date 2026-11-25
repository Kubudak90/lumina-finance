// @vitest-environment happy-dom
/**
 * ui-usability-v1 §6 #3, TxSteps: it appears when an approval is needed; stays visible through
 * step 2 after the allowance refresh; shows "aborted" on a pre-send re-check failure (with
 * re-approval offered when needed); shows "cancelled" on an input or account change without
 * unmounting and with row 1's state kept; and does not wedge after a step-1 receipt error. The
 * Details disclosure shows the planned approve + action calls before anything is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BOB, fake, failReceipt, hashOf, mine, replaceTx, resetFake, setRead, update } from "../support/fakeChain";
import { POOL, USDC, WETH, fake as addr } from "../support/deployment";
import { defaultTxChain, txChain } from "../support/txChain";
import { repayApproval } from "@/lib/approvals";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));

import { SupplyModal } from "@/components/actions/SupplyModal";
import { RepayModal } from "@/components/actions/RepayModal";

const WETH_DEBT_TOKEN = addr(0x500);

beforeEach(() => {
  resetFake();
  fake.multicall = txChain(defaultTxChain());
  setRead(USDC, "balanceOf", 10_000_000_000n);
  setRead(USDC, "allowance", 0n);
});
afterEach(() => cleanup());

const steps = () => screen.queryByTestId("tx-steps");
const step = (n: 1 | 2) => screen.getByTestId(`tx-step-${n}`);
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const renderSupply = () => render(<SupplyModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
const type = (value: string) => fireEvent.change(screen.getByLabelText("Amount"), { target: { value } });

describe("TxSteps: when it shows", () => {
  it("appears when an approval is needed, with both rows before anything is sent", () => {
    renderSupply();
    expect(steps()).toBeNull();
    type("1.5");
    expect(steps()).toBeTruthy();
    expect(step(1).textContent).toContain("Approve USDC 1.5");
    expect(step(1).dataset.state).toBe("not started");
    expect(step(2).textContent).toContain("Supply USDC");
    expect(step(2).dataset.state).toBe("waiting");
  });

  it("does not appear when the allowance already covers the amount", () => {
    setRead(USDC, "allowance", 2_000_000n);
    renderSupply();
    type("1.5");
    expect(steps()).toBeNull();
  });

  it("stays visible through step 2 after the allowance refresh, with row 1's label frozen", async () => {
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    expect(step(1).dataset.state).toBe("confirming");
    // The approval lands: the polled allowance now covers the amount (needsApproval → false).
    await act(async () => setRead(USDC, "allowance", 1_500_000n));
    expect(steps()).toBeTruthy();
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve", "supply"]);
    expect(steps()).toBeTruthy();
    expect(step(1).dataset.state).toBe("done");
    expect(step(1).textContent).toContain("Approve USDC 1.5");
    expect(step(2).dataset.state).toBe("confirming");
  });
});

describe("TxSteps: aborted, cancelled, failed", () => {
  it("a pre-send re-check failure shows row 2 'aborted' with the reason; nothing is sent", async () => {
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    await act(async () => {
      setRead(USDC, "allowance", 1_500_000n);
      setRead(USDC, "balanceOf", 1_000_000n); // spent elsewhere while approving
    });
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve"]);
    expect(step(1).dataset.state).toBe("done");
    expect(step(2).dataset.state).toBe("aborted");
    expect(step(2).textContent).toMatch(/aborted: your wallet balance no longer covers the amount/);
  });

  it("an abort that needs a new approval says so and the button offers it again (repay past the headroom)", async () => {
    setRead(WETH, "balanceOf", 2n * 10n ** 18n);
    setRead(WETH_DEBT_TOKEN, "balanceOf", 10n ** 18n);
    setRead(WETH, "allowance", 0n);
    render(<RepayModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    fireEvent.click(button("MAX"));
    await act(async () => fireEvent.click(button("Approve WETH")));
    await act(async () => {
      setRead(WETH_DEBT_TOKEN, "balanceOf", 1_000_600_000_000_000_000n); // +0.06%: past the headroom
      setRead(WETH, "allowance", repayApproval(10n ** 18n));
    });
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(step(2).dataset.state).toBe("aborted");
    expect(step(2).textContent).toMatch(/approve again to continue/);
    expect(button("Approve WETH").disabled).toBe(false);
    // Taking the offer starts a new flow: row 1 restarts with the new (frozen) amount.
    await act(async () => fireEvent.click(button("Approve WETH")));
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve", "approve"]);
    expect(fake.sends[1].args).toEqual([POOL, repayApproval(1_000_600_000_000_000_000n)]);
    expect(step(1).dataset.state).toBe("confirming");
    expect(step(2).dataset.state).toBe("waiting");
  });

  it("an input edit during the approval → row 2 'cancelled', row 1 keeps its true state, nothing unmounts", async () => {
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    type("2");
    expect(steps()).toBeTruthy();
    expect(step(2).dataset.state).toBe("cancelled");
    expect(step(2).textContent).toMatch(/cancelled: the inputs changed/);
    expect(step(1).dataset.state).toBe("confirming");
    expect(step(1).textContent).toContain("Approve USDC 1.5"); // frozen at what was approved
    // The approval still mines: row 1 shows it, and no supply follows.
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(step(1).dataset.state).toBe("done");
    expect(step(2).dataset.state).toBe("cancelled");
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve"]);
    // The next edit clears the session: a fresh, not-started flow for the new amount.
    type("3");
    expect(step(1).dataset.state).toBe("not started");
    expect(step(1).textContent).toContain("Approve USDC 3");
  });

  it("an account change during the approval → row 2 'cancelled', row 1 kept", async () => {
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    await act(async () => update((f) => (f.account = BOB)));
    expect(steps()).toBeTruthy();
    expect(step(2).dataset.state).toBe("cancelled");
    expect(step(2).textContent).toMatch(/account/);
    expect(step(1).dataset.state).toBe("confirming");
  });

  it("a step-1 receipt error does not wedge the flow: row 1 'failed', the button is usable again", async () => {
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    expect(button("Confirming...").disabled).toBe(true);
    await act(async () => failReceipt(hashOf(1)));
    await act(async () => {});
    expect(step(1).dataset.state).toBe("failed");
    expect(step(2).dataset.state).toBe("cancelled");
    expect(button("Approve USDC").disabled).toBe(false);
    await act(async () => fireEvent.click(button("Approve USDC")));
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve", "approve"]);
    expect(step(1).dataset.state).toBe("confirming");
  });

  it("a wallet rejection of step 1 shows 'failed' and allows a retry", async () => {
    renderSupply();
    type("1.5");
    fake.rejectNextSend = Object.assign(new Error("User rejected the request."), { code: 4001 });
    await act(async () => fireEvent.click(button("Approve USDC")));
    expect(fake.sends).toHaveLength(0);
    expect(step(1).dataset.state).toBe("failed");
    expect(step(1).textContent).toMatch(/Transaction rejected by user/);
    await act(async () => fireEvent.click(button("Approve USDC")));
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve"]);
    expect(step(1).dataset.state).toBe("confirming");
  });

  it("replaced transactions through both approval steps: sped-up succeeds with new hash, cancelled is cancelled, changed calldata fails (N-FE-02 / F8)", async () => {
    // 1. Sped-up approval (H1 -> H10) proceeds to step 2 (H2), then sped-up supply (H2 -> H20) shows TxSuccess with H20.
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    await act(async () => setRead(USDC, "allowance", 1_500_000n));
    await act(async () => replaceTx(hashOf(1), hashOf(10), "repriced", { blockNumber: 101n }));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve", "supply"]);
    expect(step(1).dataset.state).toBe("done");
    expect(step(2).dataset.state).toBe("confirming");
    await act(async () => replaceTx(hashOf(2), hashOf(20), "repriced", { blockNumber: 102n }));
    expect(screen.getByTestId("tx-success")).toBeTruthy();

    // 2. Cancelled step 2 (supply) never shows success and shows row 2 'cancelled'.
    cleanup();
    resetFake();
    fake.multicall = txChain(defaultTxChain());
    setRead(USDC, "balanceOf", 10_000_000_000n);
    setRead(USDC, "allowance", 0n);
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    await act(async () => setRead(USDC, "allowance", 1_500_000n));
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve", "supply"]);
    await act(async () => replaceTx(hashOf(2), hashOf(21), "cancelled"));
    expect(screen.queryByTestId("tx-success")).toBeNull();
    expect(step(2).dataset.state).toBe("cancelled");

    // 3. Step 2 replaced with different calldata never shows success and shows row 2 'failed'.
    cleanup();
    resetFake();
    fake.multicall = txChain(defaultTxChain());
    setRead(USDC, "balanceOf", 10_000_000_000n);
    setRead(USDC, "allowance", 0n);
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    await act(async () => setRead(USDC, "allowance", 1_500_000n));
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    await act(async () => replaceTx(hashOf(2), hashOf(22), "replaced"));
    expect(screen.queryByTestId("tx-success")).toBeNull();
    expect(step(2).dataset.state).toBe("failed");

    // 4. Step 1 cancelled shows row 1 'cancelled' and row 2 'cancelled', nothing sent for step 2.
    cleanup();
    resetFake();
    fake.multicall = txChain(defaultTxChain());
    setRead(USDC, "balanceOf", 10_000_000_000n);
    setRead(USDC, "allowance", 0n);
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    await act(async () => replaceTx(hashOf(1), hashOf(30), "cancelled"));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve"]);
    expect(step(1).dataset.state).toBe("cancelled");
    expect(step(2).dataset.state).toBe("cancelled");
    expect(button("Approve USDC").disabled).toBe(false);

    // 5. Step 1 replaced with different calldata shows row 1 'failed' and row 2 'cancelled', nothing sent for step 2.
    cleanup();
    resetFake();
    fake.multicall = txChain(defaultTxChain());
    setRead(USDC, "balanceOf", 10_000_000_000n);
    setRead(USDC, "allowance", 0n);
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    await act(async () => replaceTx(hashOf(1), hashOf(31), "replaced"));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve"]);
    expect(step(1).dataset.state).toBe("failed");
    expect(step(2).dataset.state).toBe("cancelled");
    expect(button("Approve USDC").disabled).toBe(false);
  });
});

describe("Details: the planned calls before sending (describeApprove + describeWrite)", () => {
  it("lists approve(Pool, 1.5 USDC) then supply, with the allowance note visible outside the disclosure", () => {
    renderSupply();
    type("1.5");
    const details = screen.getByTestId("tx-details");
    const calls = within(details).getAllByTestId("tx-details-call");
    expect(calls).toHaveLength(2);
    expect(calls[0].textContent).toMatch(/approve/);
    expect(calls[0].textContent).toContain(POOL);
    expect(calls[0].textContent).toContain("1500000");
    expect(calls[1].textContent).toMatch(/supply/);
    // FE-04: the approval amount stays outside the collapsed disclosure while one is required.
    const note = screen.getByTestId("approve-amount");
    expect(details.contains(note)).toBe(false);
  });
});
