// @vitest-environment happy-dom
/**
 * ui-usability-v1 §6 #3, success screens and the smaller fixes:
 * - a success screen shows "reading…" until a read at or after the receipt block resolves, then
 *   the after-state ("unavailable" when the read cannot be checked);
 * - a liquidation that heals the borrower keeps its success screen open (core and isolated), and
 *   the borrower is re-read with a block stamp;
 * - EnableCollateral's success title does not flip after the post-receipt read;
 * - IsolatedRemoveCollateral with the guard OK and the pair oracle bad is blocked and says why;
 * - a reverted send is described in context (describeTxError), never as "EMode".
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ALICE, fake, hashOf, mine, resetFake, setRead, update, useFakeVersion } from "../support/fakeChain";
import { DUAL_USDC_WETH, PAIR_USDC_WETH, POOL, USDC, WETH } from "../support/deployment";
import { MAX_HF, defaultTxChain, txChain, type TxChainState } from "../support/txChain";

const toasts = vi.hoisted(() => ({ error: [] as Array<{ title: string; description?: string }> }));

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("sonner", () => ({
  toast: {
    error: (title: string, opts?: { description?: string }) => toasts.error.push({ title, description: opts?.description }),
    success: () => {},
    warning: () => {},
  },
}));
// Isolated pair / position data for the isolated modals; the liquidations page uses the real hooks.
vi.mock("@/hooks/useUserIsolatedPositions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useUserIsolatedPositions")>();
  return {
    ...actual,
    useIsolatedPosition: (pair: string) => {
      useFakeVersion();
      const real = actual.useIsolatedPosition(pair);
      return fake.data.positionState ?? real;
    },
  };
});
vi.mock("@/hooks/useIsolatedPairs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useIsolatedPairs")>();
  return {
    ...actual,
    useIsolatedPair: (pair: string) => {
      useFakeVersion();
      const real = actual.useIsolatedPair(pair);
      return (fake.data.pair as typeof real) ?? real;
    },
  };
});

import { SupplyModal } from "@/components/actions/SupplyModal";
import { BorrowModal } from "@/components/actions/BorrowModal";
import { EnableCollateralModal } from "@/components/actions/EnableCollateralModal";
import { IsolatedAddCollateralModal } from "@/components/actions/IsolatedAddCollateralModal";
import { IsolatedRemoveCollateralModal } from "@/components/actions/IsolatedRemoveCollateralModal";
import LiquidationsPage from "@/app/(app)/liquidations/page";

const BORROWER = "0x00000000000000000000000000000000000B0Bb0" as const;
const RATE = 5n * 10n ** 26n;
const lc = (a: string) => a.toLowerCase();

const pairInfo = {
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
  totalAssetAmount: 1_000_000_000_000n,
  totalAssetShares: 1_000_000_000_000n,
  totalBorrowAmount: 100_000_000n,
  totalBorrowShares: 100_000_000n,
  totalCollateral: 10n ** 18n,
  borrowLimit: (1n << 200n) - 1n,
  availableLiquidity: 999_900_000_000n,
  utilization: 0,
  exchangeRate: RATE,
  oracleBadData: false as boolean | undefined,
  loaded: true,
};
const isolatedPosition = (borrowedShares: bigint) => ({
  status: "known" as const,
  position: { ...pairInfo, suppliedShares: 0n, suppliedAssets: 0n, borrowedShares, borrowedAssets: borrowedShares, collateralAmount: 10n ** 18n },
});

let chain: TxChainState;

beforeEach(() => {
  resetFake();
  toasts.error.length = 0;
  chain = defaultTxChain();
  chain.accounts[lc(ALICE)] = { supplied: { [lc(WETH)]: 10n ** 18n }, borrowed: { [lc(USDC)]: 1_000_000_000n }, collateral: { [lc(WETH)]: true } };
  chain.accounting = [1_000_000_000_000n, 1_000_000_000_000n, 100_000_000n, 100_000_000n, 10n ** 18n];
  chain.snapshots[lc(ALICE)] = [0n, 100_000_000n, 10n ** 18n];
  fake.multicall = txChain(chain);
  setRead(WETH, "balanceOf", 10n * 10n ** 18n);
  setRead(USDC, "balanceOf", 10_000_000_000n);
  setRead(WETH, "allowance", 10n ** 24n);
  setRead(USDC, "allowance", 10n ** 24n);
});
afterEach(() => cleanup());

const afterState = () => screen.getByTestId("after-state");
const afterRow = (label: string) => afterState().querySelector(`[data-row^="${label}"]`)?.textContent ?? "";
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("success screen: the after-state comes from a read at or after the receipt block", () => {
  it("core supply: 'reading…' while the position read is older than the receipt, then the new HF", async () => {
    render(<SupplyModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    type("Amount", "1");
    await act(async () => fireEvent.click(button("Supply WETH")));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["supply"]);
    // Mined in block 101; the position poll still answers from block 100.
    await act(async () => mine(hashOf(1), "success", 101n));
    expect(screen.getByText("Supply Successful")).toBeTruthy();
    expect(afterState().dataset.status).toBe("reading");
    expect(afterState().textContent).toContain("reading…");
    // The next read is at block 101 and sees the supply.
    await act(async () =>
      update(() => {
        chain.block = 101n;
        chain.accounts[lc(ALICE)].supplied[lc(WETH)] = 2n * 10n ** 18n;
      }),
    );
    expect(afterState().dataset.status).toBe("ready");
    expect(afterRow("Health factor")).toContain("3.20");
    expect(afterState().textContent).toContain("as of block 101");
  });

  it("core: a position read without a block stamp reads 'unavailable', never a stale after-state", async () => {
    render(<SupplyModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    type("Amount", "1");
    await act(async () => fireEvent.click(button("Supply WETH")));
    await act(async () => {});
    await act(async () => update(() => (chain.stampFails = true)));
    await act(async () => mine(hashOf(1), "success", 101n));
    expect(afterState().dataset.status).toBe("unavailable");
    expect(afterState().textContent).toContain("unavailable");
  });

  it("isolated add-collateral: 'reading…', then LTV and collateral from the block-101 read", async () => {
    fake.data.pair = pairInfo;
    fake.data.positionState = isolatedPosition(100_000_000n);
    render(<IsolatedAddCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "1");
    await act(async () => fireEvent.click(button("Add WETH")));
    await act(async () => {});
    await act(async () => mine(hashOf(1), "success", 101n));
    expect(afterState().dataset.status).toBe("reading");
    await act(async () =>
      update(() => {
        chain.block = 101n;
        chain.snapshots[lc(ALICE)] = [0n, 100_000_000n, 2n * 10n ** 18n];
      }),
    );
    expect(afterState().dataset.status).toBe("ready");
    expect(afterRow("LTV")).toContain("2.50%");
    expect(afterRow("Collateral")).toContain("2 WETH");
  });
});

describe("EnableCollateral: the success title is latched at submit", () => {
  it("stays 'Collateral Enabled' when the post-receipt read flips currentlyEnabled", async () => {
    const view = render(<EnableCollateralModal asset={WETH} symbol="WETH" currentlyEnabled={false} onClose={() => {}} />);
    await act(async () => fireEvent.click(button("Enable Collateral")));
    await act(async () => mine(hashOf(1), "success", 101n));
    expect(screen.getByText("Collateral Enabled")).toBeTruthy();
    // The parent re-reads the flag after the receipt and passes the new value.
    view.rerender(<EnableCollateralModal asset={WETH} symbol="WETH" currentlyEnabled onClose={() => {}} />);
    expect(screen.getByText("Collateral Enabled")).toBeTruthy();
    expect(screen.getByText("You enabled WETH as collateral")).toBeTruthy();
    expect(screen.queryByText(/Collateral Disabled/)).toBeNull();
  });
});

describe("IsolatedRemoveCollateral: blocked like IsolatedBorrow while in debt", () => {
  it("guard OK, pair oracle flags bad data → blocked with a notice that says why", () => {
    fake.data.pair = { ...pairInfo, oracleBadData: true };
    fake.data.positionState = isolatedPosition(100_000_000n);
    render(<IsolatedRemoveCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "0.1");
    expect(button("Removal blocked").disabled).toBe(true);
    expect(screen.getByTestId("oracle-block-notice").textContent).toMatch(/bad data/);
  });

  it("guard OK, pair oracle unreadable → blocked, and the notice says it cannot be read", () => {
    fake.data.pair = { ...pairInfo, oracleBadData: undefined };
    fake.data.positionState = isolatedPosition(100_000_000n);
    render(<IsolatedRemoveCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "0.1");
    expect(button("Removal blocked").disabled).toBe(true);
    expect(screen.getByTestId("oracle-block-notice").textContent).toMatch(/cannot be read/);
  });

  it("guard blocked (REFERENCE_STALE), oracle fine → blocked; GuardNotice explains, no oracle notice", () => {
    chain.guardStatus = 4;
    fake.data.pair = pairInfo;
    fake.data.positionState = isolatedPosition(100_000_000n);
    render(<IsolatedRemoveCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "0.1");
    expect(button("Removal blocked").disabled).toBe(true);
    expect(screen.getByText(/Borrow status: REFERENCE_STALE/)).toBeTruthy();
    expect(screen.queryByTestId("oracle-block-notice")).toBeNull();
  });

  it("no debt → not blocked even with a bad oracle, and no guard notice", () => {
    chain.guardStatus = 4;
    fake.data.pair = { ...pairInfo, oracleBadData: true };
    fake.data.positionState = isolatedPosition(0n);
    render(<IsolatedRemoveCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "0.1");
    expect(button("Remove WETH").disabled).toBe(false);
    expect(screen.queryByText(/Borrow status/)).toBeNull();
  });
});

describe("liquidations: the modal stays mounted by the selected target", () => {
  function checkBorrower() {
    render(<LiquidationsPage />);
    fireEvent.change(screen.getByPlaceholderText("0x... borrower address"), { target: { value: BORROWER } });
    fireEvent.click(button("Check"));
  }

  it("core: the borrower heals after the liquidation → the success screen stays, with the borrower re-read at ≥ the receipt block", async () => {
    chain.accounts[lc(BORROWER)] = {
      supplied: { [lc(WETH)]: 10n ** 18n },
      borrowed: { [lc(USDC)]: 1_900_000_000n },
      collateral: { [lc(WETH)]: true },
      healthFactor: 9n * 10n ** 17n,
    };
    setRead(POOL, "getUserAccountData", [0n, 0n, 0n, 0n, 0n, 9n * 10n ** 17n]);
    checkBorrower();
    await act(async () => fireEvent.click(button("Liquidate")));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "100" } });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Execute Liquidation" })));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "liquidationCall", address: POOL });
    await act(async () => mine(hashOf(1), "success", 101n));
    expect(screen.getByText("Liquidation Successful")).toBeTruthy();
    // The page's poll now sees a healthy borrower: it drops out of the liquidatable list.
    await act(async () => setRead(POOL, "getUserAccountData", [0n, 0n, 0n, 0n, 0n, 12n * 10n ** 17n]));
    expect(screen.getByText(/No liquidation opportunities found/)).toBeTruthy();
    expect(screen.getByText("Liquidation Successful")).toBeTruthy();
    expect(afterState().dataset.status).toBe("reading"); // the borrower read is still at block 100
    await act(async () =>
      update(() => {
        chain.block = 101n;
        chain.accounts[lc(BORROWER)].borrowed[lc(USDC)] = 1_800_000_000n;
        chain.accounts[lc(BORROWER)].healthFactor = 12n * 10n ** 17n;
      }),
    );
    expect(afterState().dataset.status).toBe("ready");
    expect(afterRow("Borrower health factor")).toContain("1.20");
    expect(afterRow("Borrower debt")).toContain("1,800 USDC");
  });

  it("isolated: a full liquidation removes the borrower from the list → the success screen stays", async () => {
    setRead(POOL, "getUserAccountData", [0n, 0n, 0n, 0n, 0n, MAX_HF]);
    chain.snapshots[lc(BORROWER)] = [0n, 100n, 10n ** 17n];
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 100_000_000n);
    checkBorrower();
    await act(async () => fireEvent.click(screen.getAllByRole("button", { name: "Liquidate" })[0]));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "MAX" }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Liquidate" })));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "liquidate", address: PAIR_USDC_WETH });
    await act(async () => mine(hashOf(1), "success", 101n));
    // Fully liquidated: no borrow shares left, so the page drops the position.
    await act(async () =>
      update(() => {
        chain.block = 101n;
        chain.snapshots[lc(BORROWER)] = [0n, 0n, 5n * 10n ** 16n];
      }),
    );
    expect(screen.getByText(/No isolated debt for this address/)).toBeTruthy();
    expect(screen.getByText("Liquidation Successful")).toBeTruthy();
    expect(afterState().dataset.status).toBe("ready");
    expect(afterRow("Borrower debt")).toContain("0 USDC");
    expect(afterRow("Borrower collateral")).toContain("0.05 WETH");
  });
});

describe("describeTxError in the modals", () => {
  it("a borrow reverted with Aave '59' reads as the price guard, never as an eMode error", async () => {
    chain.accounts[lc(ALICE)].accountData = [2_000n * 10n ** 8n, 1_000n * 10n ** 8n, 500n * 10n ** 8n, 8_000n, 7_500n, 16n * 10n ** 17n];
    render(<BorrowModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    type("Amount", "10");
    fake.rejectNextSend = new Error('The contract function "borrow" reverted with the following reason:\n59');
    await act(async () => fireEvent.click(button("Borrow USDC")));
    await act(async () => {});
    const toast = toasts.error.find((t) => t.title === "Borrow failed");
    expect(toast?.description).toMatch(/price guard/);
    expect(toast?.description).not.toMatch(/EMode/i);
  });

  it("every modal reports errors through describeTxError (no parseErrorMessage left)", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "../../components/actions");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/parseErrorMessage|errorMessages/);
      expect(source, file).toMatch(/useTxErrorToast\(tx\.error/);
    }
  });
});
