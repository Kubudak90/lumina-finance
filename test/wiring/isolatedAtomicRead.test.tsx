// @vitest-environment happy-dom
/**
 * U4 review r1 #3: the isolated borrower modals take the form's position (collateral, debt,
 * shares), the pair's rate, maxLTV and limits, the MAX and the price block from the modal's ONE
 * stamped read — the block TxSummary shows — never from the polled caches the page was rendered
 * from. A borrow / removal is blocked when EITHER the modal's read or the polled pair info flags
 * bad data (or cannot read it). Scenario (Gemini): the dashboard's poll still holds block 1000
 * (1 WETH collateral, 1,000 USDC debt, ETH $2,000, oracle OK, LTV 50%) when block 1005 lands with
 * ETH $1,600 or isBadData, and the user opens the modal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ALICE, fake, resetFake, setRead, useFakeVersion } from "../support/fakeChain";
import { DUAL_USDC_WETH, PAIR_USDC_WETH, USDC, WETH } from "../support/deployment";
import { defaultTxChain, txChain, type TxChainState } from "../support/txChain";
import { isolatedBorrowMaxFromReads } from "@/lib/borrowMax";
import { formatToken } from "@/components/tx/format";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
// The polled caches the page rendered from (block 1000): what the modals must NOT take their form from.
vi.mock("@/hooks/useIsolatedPairs", () => ({
  useIsolatedPair: () => {
    useFakeVersion();
    return fake.data.pair;
  },
}));
vi.mock("@/hooks/useUserIsolatedPositions", () => ({
  useIsolatedPosition: () => {
    useFakeVersion();
    return fake.data.positionState;
  },
}));

import { IsolatedBorrowModal } from "@/components/actions/IsolatedBorrowModal";
import { IsolatedRepayModal } from "@/components/actions/IsolatedRepayModal";
import { IsolatedRemoveCollateralModal } from "@/components/actions/IsolatedRemoveCollateralModal";
import { IsolatedAddCollateralModal } from "@/components/actions/IsolatedAddCollateralModal";

const E6 = 10n ** 6n;
const E18 = 10n ** 18n;
/** Pair rate R (WETH wei per USDC unit × 1e18) for an ETH price in USD. */
const rateAt = (ethUsd: bigint) => (10n ** 30n) / ethUsd; // $2,000 → 5e26, $1,600 → 6.25e26
const lc = (a: string) => a.toLowerCase();

/** The poll cache at block 1000. */
const cachedPair = {
  name: "USDC/WETH",
  pair: PAIR_USDC_WETH,
  asset: USDC,
  collateral: WETH,
  assetSymbol: "USDC",
  collateralSymbol: "WETH",
  assetDecimals: 6,
  collateralDecimals: 18,
  dualOracle: DUAL_USDC_WETH,
  deployed: true,
  maxLTV: 75_000n,
  totalAssetAmount: 1_000_000n * E6,
  totalAssetShares: 1_000_000n * E6,
  totalBorrowAmount: 1_000n * E6,
  totalBorrowShares: 1_000n * E6,
  totalCollateral: E18,
  borrowLimit: (1n << 200n) - 1n,
  availableLiquidity: 999_000n * E6,
  utilization: 0,
  exchangeRate: rateAt(2_000n) as bigint | undefined,
  oracleBadData: false as boolean | undefined,
  loaded: true,
};
const cachedPosition = {
  status: "known" as const,
  position: { ...cachedPair, suppliedShares: 0n, suppliedAssets: 0n, borrowedShares: 1_000n * E6, borrowedAssets: 1_000n * E6, collateralAmount: E18 },
};

let chain: TxChainState;

beforeEach(() => {
  resetFake();
  chain = defaultTxChain();
  // The chain (block 1005 for the modal's own read) starts equal to the cache.
  chain.block = 1_005n;
  chain.snapshots[lc(ALICE)] = [0n, 1_000n * E6, E18];
  chain.accounting = [1_000_000n * E6, 1_000_000n * E6, 1_000n * E6, 1_000n * E6, E18];
  chain.oracle = [false, rateAt(2_000n), rateAt(2_000n)];
  fake.multicall = txChain(chain);
  fake.data.pair = cachedPair;
  fake.data.positionState = cachedPosition;
  setRead(WETH, "balanceOf", 10n * E18);
  setRead(USDC, "balanceOf", 10_000n * E6);
  setRead(WETH, "allowance", 10n ** 30n);
  setRead(USDC, "allowance", 10n ** 30n);
});
afterEach(() => cleanup());

const summary = () => screen.getByTestId("tx-summary");
const row = (label: string) => summary().querySelector(`[data-row^="${label}"]`)?.textContent ?? "";
const gauge = () => within(summary()).getByRole("meter").getAttribute("aria-valuetext") ?? "";
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const sendButton = (names: RegExp) => screen.getAllByRole("button").find((b) => names.test(b.textContent ?? "")) as HTMLButtonElement;

/** Whatever the inputs: while the summary says liquidatable or price data stale, nothing can be sent. */
function expectNoSendWhileSummaryWarns(button: HTMLButtonElement) {
  const warns = /Liquidatable/.test(gauge()) || screen.queryByTestId("price-stale") !== null;
  if (warns) expect(button.disabled).toBe(true);
  return warns;
}

describe("IsolatedBorrowModal: MAX, LTV and the gate follow the modal's read, not the poll", () => {
  it("ETH fell to $1,600 since the poll: MAX is the read's 198 USDC (not the cache's 495); the cache's MAX is refused", () => {
    chain.oracle = [false, rateAt(1_600n), rateAt(1_600n)];
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);

    const fromRead = isolatedBorrowMaxFromReads({
      collateral: E18,
      currentDebt: 1_000n * E6,
      exchangeRate: rateAt(1_600n),
      maxLtv: 75_000n,
      availableLiquidity: 999_000n * E6,
      borrowLimit: (1n << 200n) - 1n,
      totalBorrow: 1_000n * E6,
    })!;
    expect(fromRead).toBe(198n * E6);
    expect(screen.getByTestId("borrow-max").textContent).toBe(formatToken(fromRead, 6, "USDC")); // "198 USDC", not "495 USDC"

    // MAX → the summary (same read) stays below max LTV, and the borrow can go.
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(row("LTV")).toContain("62.50% → 74.88%");
    expect(gauge()).toBe("74.88%, Danger");
    const borrow = sendButton(/^(Borrow USDC|Borrowing blocked)$/);
    expect(borrow.disabled).toBe(false);
    expect(expectNoSendWhileSummaryWarns(borrow)).toBe(false);

    // The cache's MAX (495 USDC at $2,000) would be liquidatable at the read's price: refused.
    type("Borrow", "495");
    expect(row("LTV")).toContain("62.50% → 93.44%");
    expect(gauge()).toBe("93.44%, Liquidatable");
    expect(sendButton(/^(Borrow USDC|Borrowing blocked)$/).disabled).toBe(true);
    expect(expectNoSendWhileSummaryWarns(sendButton(/^(Borrow USDC|Borrowing blocked)$/))).toBe(true);
  });

  it("the read flags bad data while the poll still says OK → blocked, explained, and the summary says stale", () => {
    chain.oracle = [true, rateAt(2_000n), rateAt(2_000n)];
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Borrow", "100");
    expect(screen.getByTestId("price-stale")).toBeTruthy();
    const button = sendButton(/^(Borrow USDC|Borrowing blocked)$/);
    expect(button.textContent).toBe("Borrowing blocked");
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId("oracle-block-notice").textContent).toMatch(/bad data/);
    expect(expectNoSendWhileSummaryWarns(button)).toBe(true);
  });

  it("the poll flags bad data while the read says OK → still blocked (either source blocks)", () => {
    fake.data.pair = { ...cachedPair, oracleBadData: true };
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Borrow", "100");
    expect(sendButton(/^(Borrow USDC|Borrowing blocked)$/).disabled).toBe(true);
    expect(screen.getByTestId("oracle-block-notice").textContent).toMatch(/bad data/);
  });

  it("the read has not answered yet: no MAX and no borrow from the cache (it waits for the read)", () => {
    const answered = fake.multicall;
    // The modal's own read (the only multicall with getUserSnapshot here) is still loading.
    fake.multicall = (calls) => (calls.some((c) => c.functionName === "getUserSnapshot") ? undefined : answered(calls));
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Borrow", "100");
    expect(screen.getByTestId("borrow-max").textContent).toBe("unavailable");
    expect(screen.getByTestId("position-unknown").textContent).toMatch(/Reading your position/);
    expect(screen.queryByText(/Already posted/)).toBeNull();
    expect(sendButton(/^(Borrow USDC|Borrowing blocked)$/).disabled).toBe(true);
  });

  it("collateral and debt in the form are the read's: 'Already posted' and 'Max LTV' match the summary", () => {
    chain.snapshots[lc(ALICE)] = [0n, 1_000n * E6, 2n * E18]; // another tab posted 1 WETH more
    chain.maxLtv = 70_000n; // and the pair's maxLTV changed
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    expect(screen.getByText(/Already posted: 2 WETH/)).toBeTruthy();
    expect(screen.getByText(/Max LTV in this pair is 70.00%/)).toBeTruthy();
    type("Borrow", "1");
    expect(row("Collateral")).toContain("2 WETH → 2 WETH");
    expect(row("LTV")).toContain("(max 70.00%)");
  });
});

describe("IsolatedRepayModal: debt, shares and MAX from the modal's read", () => {
  it("600 of the 1,000 USDC were repaid elsewhere since the poll → the form says 600 and MAX repays 600", () => {
    chain.snapshots[lc(ALICE)] = [0n, 600n * E6, E18];
    chain.accounting = [1_000_000n * E6, 1_000_000n * E6, 600n * E6, 600n * E6, E18];
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 600n * E6);
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    expect(screen.getByText(/^Debt:/).textContent).toBe("Debt: 600 USDC"); // the cache says 1,000
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(row("Debt")).toContain("600 USDC → 0 USDC");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("600");
  });

  it("the read failed: repaying is disabled even though the cache knows the position", () => {
    const answered = fake.multicall;
    fake.multicall = (calls) =>
      answered(calls)?.map((r, i) => (calls[i].functionName === "getUserSnapshot" ? { status: "failure" as const, error: new Error("snapshot failed") } : r));
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    expect(screen.getByTestId("position-unknown").textContent).toMatch(/could not be read/);
    expect((screen.getByRole("button", { name: "MAX" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("IsolatedRemoveCollateralModal: posted collateral, debt and the gate from the modal's read", () => {
  it("the read flags bad data while the poll still says OK (in debt) → blocked, explained, summary stale", () => {
    chain.oracle = [true, rateAt(2_000n), rateAt(2_000n)];
    render(<IsolatedRemoveCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "0.1");
    expect(screen.getByTestId("price-stale")).toBeTruthy();
    const button = sendButton(/^(Remove WETH|Removal blocked)$/);
    expect(button.textContent).toBe("Removal blocked");
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId("oracle-block-notice").textContent).toMatch(/bad data/);
    expect(expectNoSendWhileSummaryWarns(button)).toBe(true);
  });

  it("ETH fell to $1,600: removing 0.7 of 1.5 WETH is liquidatable at the read's price → nothing can be sent; 'Posted' is the read's", () => {
    chain.oracle = [false, rateAt(1_600n), rateAt(1_600n)];
    chain.snapshots[lc(ALICE)] = [0n, 1_000n * E6, 15n * E18 / 10n]; // 1.5 WETH posted now (the cache says 1)
    render(<IsolatedRemoveCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    expect(screen.getByText(/^Posted:/).textContent).toBe("Posted: 1.5 WETH");
    type("Amount", "0.7"); // 0.8 WETH = $1,280 against 1,000 USDC: LTV 78.13% > 75%
    expect(gauge()).toBe("78.13%, Liquidatable");
    expect(screen.getByTestId("remove-insolvent")).toBeTruthy();
    expect(expectNoSendWhileSummaryWarns(sendButton(/^(Remove WETH|Removal blocked)$/))).toBe(true);
    // 0.1 WETH (1.4 WETH left: LTV 44.64%) is fine at the same price.
    type("Amount", "0.1");
    expect(gauge()).toMatch(/Safe/);
    expect(sendButton(/^(Remove WETH|Removal blocked)$/).disabled).toBe(false);
  });
});

describe("IsolatedAddCollateralModal (checked): its summary already reads only the modal's read", () => {
  it("shows the read's position, and stays allowed while the price is bad (spec §5.4)", () => {
    chain.oracle = [true, rateAt(1_600n), rateAt(1_600n)];
    render(<IsolatedAddCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "1");
    expect(row("LTV")).toContain("62.50% → 31.25%");
    expect(sendButton(/^(Add WETH|Approve WETH)$/).disabled).toBe(false);
  });
});
