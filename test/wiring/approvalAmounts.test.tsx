// @vitest-environment happy-dom
/**
 * U4 review r2 #1: approval and allowance figures are shown EXACTLY, never truncated — in
 * AllowanceNote ("Approves (exact)", "Approves (value + 0.1% + 1 wei)", the current allowance and
 * the estimated residual), in TxSteps' row 1 ("1 Approve ‹token› ‹amount›") and in PostTxAllowance —
 * so they equal the approve call's amount, and an allowance short of the approval never reads the
 * same as the approval it triggers. Positions and balances keep the 4-place amount formatter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { formatUnits } from "viem";
import { fake, resetFake, setRead } from "../support/fakeChain";
import { POOL, WETH, fake as addr } from "../support/deployment";
import { defaultTxChain, txChain } from "../support/txChain";
import { repayApproval } from "@/lib/approvals";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));

import { AllowanceNote } from "@/components/common/AllowanceNote";
import { PostTxAllowance } from "@/components/common/PostTxAllowance";
import { SupplyModal } from "@/components/actions/SupplyModal";
import { RepayModal } from "@/components/actions/RepayModal";

const WETH_DEBT_TOKEN = addr(0x500); // markets.core[0] = WETH
/** 0.05 WETH of debt → repayApproval = ceil(0.05 × 1.001) + 1 wei = 0.050050000000000001 WETH. */
const DEBT = 50_000_000_000_000_000n;
const BUFFERED = repayApproval(DEBT);
/** An allowance that falls short of it: 0.05001 WETH. */
const SHORT_ALLOWANCE = 50_010_000_000_000_000n;

beforeEach(() => {
  resetFake();
  fake.multicall = txChain(defaultTxChain());
  setRead(WETH, "balanceOf", 10n ** 18n);
  setRead(WETH, "allowance", 0n);
});
afterEach(() => cleanup());

/** The value column of an AllowanceNote line, by its label. */
const noteValue = (label: RegExp) => {
  const line = screen.getByText(label).parentElement!;
  return line.children[1].textContent;
};
const rowOne = () => screen.getByTestId("tx-step-1").textContent ?? "";

describe("AllowanceNote: every figure exact", () => {
  it("'Approves (exact)' of 0.123456 WETH reads 0.123456 WETH, not 0.1234", () => {
    render(<AllowanceNote symbol="WETH" decimals={18} spenderLabel="Pool" allowance={0n} approveAmount={123_456_000_000_000_000n} />);
    expect(screen.getByTestId("approve-amount").textContent).toBe("0.123456 WETH");
  });

  it("a buffered repay approval in full; a short allowance reads differently from it; the residual is exact", () => {
    expect(BUFFERED).toBe(50_050_000_000_000_001n);
    render(
      <AllowanceNote
        symbol="WETH"
        decimals={18}
        spenderLabel="Pool"
        allowance={SHORT_ALLOWANCE}
        approveAmount={BUFFERED}
        expectedPull={DEBT}
        buffered
      />,
    );
    expect(screen.getByTestId("approve-amount").textContent).toBe("0.050050000000000001 WETH");
    expect(noteValue(/Allowance to Pool/)).toBe("0.05001 WETH");
    expect(noteValue(/Allowance to Pool/)).not.toBe(screen.getByTestId("approve-amount").textContent);
    // Residual = effective allowance (the approval) − the expected pull, exactly.
    expect(noteValue(/Residual after repay/)).toBe("≈ 0.000050000000000001 WETH");
  });

  it("a 1-wei allowance reads 0.000000000000000001, never '<0.0001'", () => {
    render(<AllowanceNote symbol="WETH" decimals={18} spenderLabel="Pool" allowance={1n} />);
    expect(noteValue(/Allowance to Pool/)).toBe("0.000000000000000001 WETH");
  });
});

describe("TxSteps row 1 is the approve call's amount, exactly", () => {
  it("supply 0.123456 WETH: row 1, the note and the approve call all say 0.123456", async () => {
    render(<SupplyModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0.123456" } });
    expect(rowOne()).toContain("Approve WETH 0.123456");
    expect(screen.getByTestId("approve-amount").textContent).toBe("0.123456 WETH");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve WETH" })));
    expect(fake.sends[0]).toMatchObject({ functionName: "approve", args: [POOL, 123_456_000_000_000_000n] });
    expect(rowOne()).toContain(`Approve WETH ${formatUnits(fake.sends[0].args![1] as bigint, 18)}`);
  });

  it("repay all of 0.05 WETH with a 0.05001 allowance: row 1 = 0.050050000000000001 = the approve call; the allowance reads 0.05001", async () => {
    setRead(WETH_DEBT_TOKEN, "balanceOf", DEBT);
    setRead(WETH, "allowance", SHORT_ALLOWANCE);
    render(<RepayModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(rowOne()).toContain("Approve WETH 0.050050000000000001");
    expect(screen.getByTestId("approve-amount").textContent).toBe("0.050050000000000001 WETH");
    expect(noteValue(/Allowance to Pool/)).toBe("0.05001 WETH");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve WETH" })));
    const approved = fake.sends[0].args![1] as bigint;
    expect(approved).toBe(BUFFERED);
    expect(rowOne()).toContain(`Approve WETH ${formatUnits(approved, 18)}`);
    expect(within(screen.getByTestId("tx-steps")).queryByText(/0\.05(?!0)/)).toBeNull(); // never shortened
  });
});

describe("PostTxAllowance: the remaining allowance exactly", () => {
  it("reads 0.000050000000000001 WETH, not '<0.0001'", async () => {
    render(<PostTxAllowance refetch={async () => 50_000_000_000_001n} symbol="WETH" decimals={18} spenderLabel="Pool" />);
    await act(async () => {});
    expect(screen.getByTestId("post-tx-allowance").textContent).toBe(
      "Remaining allowance to Pool (on-chain): 0.000050000000000001 WETH",
    );
  });
});
