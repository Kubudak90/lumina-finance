// @vitest-environment happy-dom
/**
 * U4 review r1 #6 (with #1 and #2): the REAL modals opened from the Dashboard's "Your positions"
 * rows show the same current values as the row they were opened from — HF, isolated LTV,
 * liquidation price, APY, debt and collateral amounts — on the same block. Nothing here is a stub:
 * the page, the data hooks and the modals all read one scripted chain (test/support/txChain plus
 * the pair's rate and conversion reads), so a formatter that drifts on either side shows up.
 * Fixture (Gemini r1): an accrued isolated debt of 500.1234… USDC against 1.23456 WETH, and a dust
 * collateral of 0.00004 WETH.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ALICE, fake, resetFake, setRead, type CallResult, type ContractCall } from "../support/fakeChain";
import { PAIR_WETH_USDC, USDC, WETH } from "../support/deployment";
import { defaultTxChain, txChain, type TxChainState } from "../support/txChain";
import { vaultToAmount } from "@/lib/approvals";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }));

import Dashboard from "@/app/(app)/dashboard/page";
import IsolatedPage from "@/app/(app)/isolated/page";
import { IsolatedPositionsTable } from "@/components/portfolio/IsolatedPositionsTable";
import { useUserIsolatedPositions } from "@/hooks/useUserIsolatedPositions";

const E6 = 10n ** 6n;
const E8 = 10n ** 8n;
const E18 = 10n ** 18n;
const lc = (a: string) => a.toLowerCase();
/** ≈ 6% APR in previewAddInterest's 1e18-per-second units. */
const RATE_PER_SEC = 1_902_587_519n;

let chain: TxChainState;

/** txChain plus what the pairs multicall and the position conversions need, consistent with it. */
function chainWithPairReads(state: TxChainState) {
  const base = txChain(state);
  const ok = (result: unknown): CallResult => ({ status: "success", result });
  return (calls: readonly ContractCall[]): readonly CallResult[] => {
    const answered = base(calls);
    const [assetAmount, assetShares, borrowAmount, borrowShares] = state.accounting;
    return calls.map((c, i) => {
      switch (c.functionName) {
        case "previewAddInterest":
          return ok([
            0n,
            0n,
            0n,
            { lastBlock: 1, feeToProtocolRate: 10_000, lastTimestamp: 1n, ratePerSec: RATE_PER_SEC, fullUtilizationRate: 1n },
            { amount: assetAmount, shares: assetShares },
            { amount: borrowAmount, shares: borrowShares },
          ]);
        case "isInterestPaused":
          return ok(false);
        // The position is in USDC/WETH only (txChain answers one snapshot for every pair).
        case "getUserSnapshot":
          return lc(c.address ?? "") === lc(PAIR_WETH_USDC) ? ok([0n, 0n, 0n]) : answered[i];
        // The pair's own conversions, at the same previewed totals as getPairAccounting.
        case "toBorrowAmount":
          return ok(vaultToAmount({ amount: borrowAmount, shares: borrowShares }, c.args![0] as bigint, c.args![1] as boolean));
        case "toAssetAmount":
          return ok(vaultToAmount({ amount: assetAmount, shares: assetShares }, c.args![0] as bigint, c.args![1] as boolean));
        default:
          return answered[i];
      }
    });
  };
}

beforeEach(() => {
  resetFake();
  chain = defaultTxChain();
  // Core: 1 WETH collateral (LT 80%), 1,000 USDC debt → HF 1.60, liquidation price $1,250.
  chain.accounts[lc(ALICE)] = {
    supplied: { [lc(WETH)]: E18 },
    borrowed: { [lc(USDC)]: 1_000n * E6 },
    collateral: { [lc(WETH)]: true },
    accountData: [2_000n * E8, 1_000n * E8, 500n * E8, 8_000n, 7_500n, 16n * 10n ** 17n],
  };
  // USDC/WETH: 500,000,000 borrow shares now worth 500.1234… USDC (accrued), against 1.23456 WETH.
  chain.accounting = [1_000_000n * E6, 1_000_000n * E6, 500_123_490n, 500_000_000n, 1_234_560_000_000_000_000n];
  chain.snapshots[lc(ALICE)] = [0n, 500_000_000n, 1_234_560_000_000_000_000n];
  fake.multicall = chainWithPairReads(chain);
  setRead(WETH, "balanceOf", 10n * E18);
  setRead(USDC, "balanceOf", 10_000n * E6);
  setRead(WETH, "allowance", 10n ** 30n);
  setRead(USDC, "allowance", 10n ** 30n);
});
afterEach(() => cleanup());

// ---------------------------------------------------------------------------------------------

const rowOf = (kind: string) => screen.getAllByTestId("position-row").find((r) => r.getAttribute("data-kind") === kind)!;
const summary = () => screen.getByTestId("tx-summary");
/** The value(s) of a TxSummary row: its "before" (and "after" when it has one). */
function summaryRow(label: string) {
  const values = summary().querySelector(`[data-row^="${label}"]`)!.children[1];
  const spans = Array.from(values.children);
  return { before: spans[0].textContent, after: spans.length > 1 ? spans[2].textContent : undefined };
}
/** The dashboard row's risk cell lines, e.g. "LTV 5.10% / 75.00% · Safe" and "Liq.: ETH below …". */
const cells = (row: HTMLElement) => Array.from(row.querySelectorAll("tr:first-child > td")).map((td) => td as HTMLElement);

describe("the real modals opened from the Dashboard show the row's current values", () => {
  it("core borrow row → BorrowModal: HF, liquidation price and borrow APY are the dashboard's", () => {
    render(<Dashboard />);
    const row = rowOf("coreBorrow");
    const [, amountCell, , apyCell, riskCell] = cells(row);
    expect(amountCell.textContent).toBe("1,000 USDC");
    const hf = /HF (\S+) ·/.exec(riskCell.textContent ?? "")![1];
    expect(hf).toBe("1.60");
    const riskCardLiq = /Liquidation price: (.+)$/.exec(within(screen.getByTestId("risk-core")).getByText(/Liquidation price/).textContent ?? "")![1];
    expect(riskCardLiq).toBe("ETH below $1,250.00");
    expect(apyCell.textContent).toBe("5.13%"); // 5% APR, half-up (U4 r1 #1)

    fireEvent.click(within(row).getByRole("button", { name: "Borrow" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    expect(summaryRow("Health factor").before).toBe(hf);
    expect(summaryRow("Liquidation price").before).toBe(riskCardLiq);
    expect(summaryRow("Borrow APY").before).toBe(apyCell.textContent);
  });

  it("isolated borrow row → IsolatedBorrowModal: LTV, liquidation price, APY, debt and collateral are the dashboard's", () => {
    render(<Dashboard />);
    const row = rowOf("isolatedBorrow");
    const [, amountCell, , apyCell, riskCell] = cells(row);
    const debt = within(amountCell).getByTestId("iso-debt-amount").textContent!.replace(/^Debt: /, "");
    const collateral = within(amountCell).getByTestId("iso-collateral-amount").textContent!.replace(/^Collateral: /, "");
    expect(debt).toBe("500.1234 USDC"); // 500.1234… USDC, 4 places, rounded down (U4 r1 #2)
    expect(collateral).toBe("1.2345 WETH"); // 1.23456 WETH
    const ltv = /LTV (\S+) \/ (\S+) ·/.exec(riskCell.textContent ?? "")!;
    const liq = /Liq\.: (.+?)$/.exec(riskCell.children[1].textContent ?? "")![1];
    expect(liq).toMatch(/^ETH below .* USDC$/);
    expect(apyCell.textContent).toMatch(/^\d+\.\d\d%$/);

    fireEvent.click(within(row).getByRole("button", { name: "Borrow" }));
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "1" } });
    expect(summary().querySelector('[data-row^="LTV"]')!.getAttribute("data-row")).toBe(`LTV (max ${ltv[2]})`);
    expect(summaryRow("LTV").before).toBe(ltv[1]);
    expect(summaryRow("Liquidation price").before).toBe(liq);
    expect(summaryRow("Borrow APY").before).toBe(apyCell.textContent);
    expect(summaryRow("Debt").before).toBe(debt);
    expect(summaryRow("Collateral").before).toBe(collateral);
  });

  it("the debt and collateral read the same on /isolated and in the portfolio's isolated table", () => {
    render(<IsolatedPage />);
    const positions = screen.getByText("Your Positions").closest("div")!.parentElement!;
    expect(within(positions).getByText("500.1234 USDC")).toBeTruthy();
    expect(within(positions).getByText("1.2345 WETH")).toBeTruthy();
    cleanup();

    function Portfolio() {
      return <IsolatedPositionsTable positions={useUserIsolatedPositions().positions} />;
    }
    render(<Portfolio />);
    const cellsText = Array.from(screen.getAllByRole("cell")).map((c) => c.textContent);
    expect(cellsText).toContain("500.1234 USDC");
    expect(cellsText).toContain("1.2345 WETH");
  });

  it("dust: 0.00004 WETH of collateral reads '<0.0001 WETH' on the dashboard, /isolated, the portfolio table and in the modal", () => {
    chain.accounting = [1_000_000n * E6, 1_000_000n * E6, 0n, 0n, 40_000_000_000_000n];
    chain.snapshots[lc(ALICE)] = [0n, 0n, 40_000_000_000_000n];
    render(<Dashboard />);
    const row = rowOf("isolatedBorrow");
    expect(within(row).getByTestId("iso-collateral-amount").textContent).toBe("Collateral: <0.0001 WETH");
    fireEvent.click(within(row).getByRole("button", { name: "Add collateral" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1" } });
    expect(summaryRow("Collateral").before).toBe("<0.0001 WETH");
    cleanup();

    render(<IsolatedPage />);
    expect(screen.getByText("<0.0001 WETH")).toBeTruthy();
    cleanup();

    function Portfolio() {
      return <IsolatedPositionsTable positions={useUserIsolatedPositions().positions} />;
    }
    render(<Portfolio />);
    expect(Array.from(screen.getAllByRole("cell")).map((c) => c.textContent)).toContain("<0.0001 WETH");
  });
});

describe("the dashboard row's values themselves (sanity: the fixture is what the comparisons above see)", () => {
  it("one position of each kind: core supply, core borrow, and the USDC/WETH borrow", () => {
    render(<Dashboard />);
    expect(screen.getAllByTestId("position-row").map((r) => r.getAttribute("data-kind")).sort()).toEqual(
      ["coreBorrow", "coreSupply", "isolatedBorrow"].sort(),
    );
    expect(rowOf("isolatedBorrow").textContent).toMatch(/USDC\/WETH/);
  });
});
