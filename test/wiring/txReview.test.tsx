// @vitest-environment happy-dom
/**
 * U2 review round 1 (Gemini stand-in), regressions:
 * #1 one follow-up at a time: no second send from a click during the pre-send re-checks, and a
 *    follow-up whose inputs / account changed during them sends nothing (row 2 "cancelled");
 * #2 row 2 goes simulating → confirm in wallet, and a step-2 wallet rejection can be retried;
 * #3 the latched liquidation modals never send to a healed / solvent borrower;
 * #4 a listed target whose live limit is unavailable is not actionable;
 * #5 the TxSteps session is per account: another account never sees the previous one's steps;
 * #6 the invalid-amount note says "clamps" only for a clamped preview;
 * #7 IsolatedBorrow explains a block by the pair oracle when the guard is OK.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { ALICE, BOB, fake, hashOf, holdReads, mine, resetFake, setRead, stepSend, update, useFakeVersion } from "../support/fakeChain";
import { DUAL_USDC_WETH, PAIR_USDC_WETH, POOL, USDC, WETH } from "../support/deployment";
import { defaultTxChain, txChain, type TxChainState } from "../support/txChain";
import { describeGuardStatus } from "@/lib/guard";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }));
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
vi.mock("@/hooks/useGuardStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useGuardStatus")>();
  return {
    ...actual,
    useGuardStatus: () => {
      useFakeVersion();
      const real = actual.useGuardStatus();
      return fake.data.guard ? { ...(fake.data.guard as object), isLoading: false } : real;
    },
  };
});

import { useApprovalFlow } from "@/hooks/useApprovalFlow";
import { actionRow } from "@/components/tx/TxSteps";
import { SupplyModal } from "@/components/actions/SupplyModal";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { BorrowModal } from "@/components/actions/BorrowModal";
import { IsolatedBorrowModal } from "@/components/actions/IsolatedBorrowModal";
import { IsolatedWithdrawModal } from "@/components/actions/IsolatedWithdrawModal";
import { IsolatedLiquidateModal } from "@/components/actions/IsolatedLiquidateModal";
import LiquidationsPage from "@/app/(app)/liquidations/page";

const BORROWER = "0x00000000000000000000000000000000000B0Bb0" as const;
const RATE = 5n * 10n ** 26n;
const BOUNDS = { maxRefAgeSec: 180, maxDeviationBps: 300, maxCorePriceAgeSec: 600 };
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
  totalBorrowAmount: 0n,
  totalBorrowShares: 0n,
  totalCollateral: 0n,
  borrowLimit: (1n << 200n) - 1n,
  availableLiquidity: 1_000_000_000_000n,
  utilization: 0,
  exchangeRate: RATE,
  oracleBadData: false as boolean | undefined,
  loaded: true,
};

let chain: TxChainState;

beforeEach(() => {
  resetFake();
  chain = defaultTxChain();
  chain.accounts[lc(ALICE)] = { supplied: { [lc(WETH)]: 10n ** 18n }, borrowed: { [lc(USDC)]: 1_000_000_000n }, collateral: { [lc(WETH)]: true } };
  fake.multicall = txChain(chain);
  setRead(USDC, "balanceOf", 10_000_000_000n);
  setRead(WETH, "balanceOf", 10n * 10n ** 18n);
  setRead(USDC, "allowance", 0n);
  setRead(WETH, "allowance", 10n ** 24n);
});
afterEach(() => cleanup());

const steps = () => screen.queryByTestId("tx-steps");
const step = (n: 1 | 2) => screen.getByTestId(`tx-step-${n}`);
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const type = (value: string, label = "Amount") => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const renderSupply = () => render(<SupplyModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
const sent = () => fake.sends.map((s) => s.functionName);

/** Approve 1.5 USDC, land the allowance, mine: the follow-up starts its (held) re-checks. */
async function approveThenHoldRecheck() {
  renderSupply();
  type("1.5");
  await act(async () => fireEvent.click(button("Approve USDC")));
  const release = holdReads();
  await act(async () => setRead(USDC, "allowance", 1_500_000n));
  await act(async () => mine(hashOf(1)));
  expect(step(2).dataset.state).toBe("checking");
  return release;
}

describe("#1 one follow-up at a time, bound to its account, chain and inputs", () => {
  it("clicks during step 2's re-checks send nothing more: exactly one supply", async () => {
    const release = await approveThenHoldRecheck();
    // The allowance now covers the amount; the button must stay busy while the re-check runs.
    const busy = button(/Supply USDC|Checking/);
    expect(busy.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(busy);
      fireEvent.click(busy);
    });
    await act(async () => release());
    await act(async () => {});
    expect(sent()).toEqual(["approve", "supply"]);
  });

  it("a double click on a one-step send (no approval) sends once", async () => {
    setRead(USDC, "allowance", 10n ** 12n);
    renderSupply();
    type("1.5");
    const release = holdReads();
    const first = button("Supply USDC");
    await act(async () => fireEvent.click(first));
    await act(async () => fireEvent.click(button(/Supply USDC|Checking/)));
    await act(async () => release());
    await act(async () => {});
    expect(sent()).toEqual(["supply"]);
  });

  it("the hook itself ignores a re-entrant proceed() while one is checking", async () => {
    let finish!: () => void;
    const onProceed = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { result } = renderHook(() =>
      useApprovalFlow<{ amount: bigint }>({ token: USDC, spender: POOL, paramsKey: "1", onProceed }),
    );
    await act(async () => {
      void result.current.proceed({ amount: 1n });
      void result.current.proceed({ amount: 1n });
    });
    expect(onProceed).toHaveBeenCalledTimes(1);
    expect(result.current.isChecking).toBe(true);
    await act(async () => finish());
    expect(result.current.isChecking).toBe(false);
  });

  it("an amount edit during the re-checks → nothing sent, row 2 'cancelled: the inputs changed'", async () => {
    const release = await approveThenHoldRecheck();
    type("2");
    expect(steps()).toBeTruthy();
    await act(async () => release());
    await act(async () => {});
    expect(sent()).toEqual(["approve"]);
    expect(step(2).dataset.state).toBe("cancelled");
    expect(step(2).textContent).toMatch(/the inputs changed/);
    expect(step(1).dataset.state).toBe("done");
  });

  it("an account switch during the re-checks → nothing sent, row 2 cancelled", async () => {
    const release = await approveThenHoldRecheck();
    await act(async () => update((f) => (f.account = BOB)));
    await act(async () => release());
    await act(async () => {});
    expect(sent()).toEqual(["approve"]);
    expect(step(2).dataset.state).toBe("cancelled");
    expect(step(2).textContent).toMatch(/account changed/);
  });

  it("IsolatedWithdraw MAX: a second click while the share balance is read sends nothing more", async () => {
    fake.data.pair = pairInfo;
    setRead(PAIR_USDC_WETH, "maxWithdraw", 100_000_000n);
    chain.snapshots[lc(ALICE)] = [95_000_000n, 0n, 0n];
    chain.maxRedeem = 95_000_000n;
    render(<IsolatedWithdrawModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(button("MAX"));
    const release = holdReads();
    await act(async () => fireEvent.click(button("Withdraw USDC")));
    const busy = button(/Withdraw USDC|Checking/);
    expect(busy.disabled).toBe(true);
    await act(async () => fireEvent.click(busy));
    await act(async () => release());
    await act(async () => {});
    expect(sent()).toEqual(["redeem"]);
  });
});

describe("#2 row 2: simulating → confirm in wallet, and a rejected step 2 can be retried", () => {
  it("both flags set (wallet prompt after a simulation) reads 'confirm in wallet'", () => {
    const steps = { approveAmount: 1n, approvalHash: null, step1: { kind: "done" as const, hash: hashOf(1) }, step2: { kind: "sent" as const } };
    const row = actionRow(steps, { isSimulating: true, isPending: true, isConfirming: false, isSuccess: false, error: null }, { venue: "core", action: "supply" });
    expect(row.state).toBe("confirm in wallet");
  });

  it("walks both rows through simulate → wallet → mined, then retries a rejected step 2", async () => {
    fake.stepSends = true;
    renderSupply();
    type("1.5");
    await act(async () => void fireEvent.click(button("Approve USDC")));
    expect(step(1).dataset.state).toBe("simulating");
    await act(async () => stepSend());
    expect(step(1).dataset.state).toBe("confirm in wallet");
    await act(async () => stepSend());
    expect(step(1).dataset.state).toBe("confirming");
    await act(async () => setRead(USDC, "allowance", 1_500_000n));
    await act(async () => mine(hashOf(1)));
    expect(step(1).dataset.state).toBe("done");
    expect(step(2).dataset.state).toBe("simulating");
    await act(async () => stepSend());
    expect(step(2).dataset.state).toBe("confirm in wallet");
    // The wallet rejects the supply.
    fake.rejectNextSend = Object.assign(new Error("User rejected the request."), { code: 4001 });
    await act(async () => stepSend());
    await act(async () => {});
    expect(step(2).dataset.state).toBe("failed");
    expect(step(2).textContent).toMatch(/Transaction rejected by user/);
    expect(sent()).toEqual(["approve"]);
    // Retry from the button (the allowance already covers it): step 2 runs again and sends.
    await act(async () => void fireEvent.click(button("Supply USDC")));
    expect(step(2).dataset.state).toBe("simulating");
    await act(async () => stepSend());
    expect(step(2).dataset.state).toBe("confirm in wallet");
    await act(async () => stepSend());
    await act(async () => {});
    expect(sent()).toEqual(["approve", "supply"]);
    expect(step(2).dataset.state).toBe("confirming");
  });
});

describe("#3 the latched liquidation modals re-check the borrower before sending", () => {
  function openCoreLiquidation(hf = 9n * 10n ** 17n) {
    chain.accounts[lc(BORROWER)] = {
      supplied: { [lc(WETH)]: 10n ** 18n },
      borrowed: { [lc(USDC)]: 1_900_000_000n },
      collateral: { [lc(WETH)]: true },
      healthFactor: hf,
    };
    setRead(POOL, "getUserAccountData", [0n, 0n, 0n, 0n, 0n, 9n * 10n ** 17n]);
    render(<LiquidationsPage />);
    fireEvent.change(screen.getByPlaceholderText("0x... borrower address"), { target: { value: BORROWER } });
    fireEvent.click(button("Check"));
    fireEvent.click(button("Liquidate"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "100" } });
    return dialog;
  }

  it("core: the borrower heals during the approval → the follow-up does not call liquidationCall", async () => {
    const dialog = openCoreLiquidation();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Approve USDC" })));
    await act(async () => {
      setRead(USDC, "allowance", 100_000_000n);
      setRead(POOL, "getUserAccountData", [0n, 0n, 0n, 0n, 0n, 12n * 10n ** 17n]); // healed: no longer listed
    });
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(sent()).toEqual(["approve"]);
    expect(screen.getByTestId("tx-step-2").dataset.state).toBe("aborted");
    expect(screen.getByTestId("liquidate-notice").textContent).toMatch(/cannot be liquidated/);
  });

  it("core: still listed, but the chain reads HF ≥ 1 right before sending → nothing sent", async () => {
    setRead(USDC, "allowance", 10n ** 12n);
    const dialog = openCoreLiquidation(12n * 10n ** 17n); // the fresh read says healthy
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Execute Liquidation" })));
    await act(async () => {});
    expect(sent()).toEqual([]);
    expect(fake.freshReads.some((c) => c.functionName === "getUserAccountData")).toBe(true);
    expect(screen.getByTestId("liquidate-notice").textContent).toMatch(/at or above 1\.0/);
  });

  it("isolated: a borrower the pair sees as solvent (50% LTV, max 75%) → nothing sent", async () => {
    fake.data.pair = pairInfo;
    setRead(USDC, "allowance", 10n ** 12n);
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 100_000_000n);
    chain.snapshots[lc(BORROWER)] = [0n, 100n, 10n ** 17n];
    render(
      <IsolatedLiquidateModal
        pair={PAIR_USDC_WETH}
        asset={USDC}
        assetSymbol="USDC"
        assetDecimals={6}
        collateralSymbol="WETH"
        collateralDecimals={18}
        borrower={BORROWER}
        borrowerDebtAsset={100_000_000n}
        borrowerDebtShares={100n}
        borrowerCollateral={10n ** 17n}
        onClose={() => {}}
      />,
    );
    fireEvent.click(button("MAX"));
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    expect(sent()).toEqual([]);
    expect(screen.getByTestId("liquidate-notice").textContent).toMatch(/solvent/);
  });
});

describe("#4 a listed target whose live limit is unavailable is not actionable", () => {
  it("a price read fails after the modal opened → the modal stays, says why, and cannot send", async () => {
    setRead(USDC, "allowance", 10n ** 12n);
    chain.accounts[lc(BORROWER)] = {
      supplied: { [lc(WETH)]: 10n ** 18n },
      borrowed: { [lc(USDC)]: 1_900_000_000n },
      collateral: { [lc(WETH)]: true },
      healthFactor: 9n * 10n ** 17n,
    };
    setRead(POOL, "getUserAccountData", [0n, 0n, 0n, 0n, 0n, 9n * 10n ** 17n]);
    render(<LiquidationsPage />);
    fireEvent.change(screen.getByPlaceholderText("0x... borrower address"), { target: { value: BORROWER } });
    fireEvent.click(button("Check"));
    fireEvent.click(button("Liquidate"));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "100" } });
    expect(within(dialog).getByRole("button", { name: "Execute Liquidation" })).toBeTruthy();
    // The WETH oracle price stops reading: the page's live limit becomes null.
    await act(async () => update(() => delete chain.prices[lc(WETH)]));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("limit-unavailable")).toBeTruthy();
    expect(screen.getByText("Max repayable: unavailable")).toBeTruthy();
    const execute = within(screen.getByRole("dialog")).getByRole("button", { name: "Execute Liquidation" }) as HTMLButtonElement;
    expect(execute.disabled).toBe(true);
  });
});

describe("#5 the TxSteps session is per account", () => {
  it("after an aborted step 2, switching accounts drops the previous account's steps", async () => {
    renderSupply();
    type("1.5");
    await act(async () => fireEvent.click(button("Approve USDC")));
    await act(async () => {
      setRead(USDC, "allowance", 1_500_000n);
      setRead(USDC, "balanceOf", 1_000_000n); // the re-check aborts: wallet too short
    });
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(step(1).dataset.state).toBe("done");
    expect(step(2).dataset.state).toBe("aborted");
    await act(async () => update((f) => (f.account = BOB)));
    // BOB's allowance (the fake's single allowance read) covers the amount: no flow to show.
    expect(steps()).toBeNull();
  });
});

describe("#6 the invalid note says 'clamps' only for a clamped preview", () => {
  it("withdraw over the balance is clamped; a borrow over the max is not", () => {
    const withdraw = render(<WithdrawModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    type("2");
    expect(screen.getByTestId("tx-summary-invalid").textContent).toMatch(/clamp/);
    withdraw.unmount();

    chain.accounts[lc(ALICE)].accountData = [2_000n * 10n ** 8n, 1_000n * 10n ** 8n, 500n * 10n ** 8n, 8_000n, 7_500n, 16n * 10n ** 17n];
    render(<BorrowModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    type("600"); // max is 495 USDC
    const note = screen.getByTestId("tx-summary-invalid").textContent;
    expect(note).toMatch(/more than you can borrow/);
    expect(note).not.toMatch(/clamp/);
  });
});

describe("#7 IsolatedBorrow says why the pair oracle blocks it while the guard is OK", () => {
  beforeEach(() => {
    fake.data.guard = describeGuardStatus(0, 0, BOUNDS);
    fake.data.positionState = { status: "known", position: undefined };
  });

  it("bad data → blocked, with the bad-data notice", () => {
    fake.data.pair = { ...pairInfo, oracleBadData: true };
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("100", "Borrow");
    expect(button("Borrowing blocked").disabled).toBe(true);
    expect(screen.getByTestId("oracle-block-notice").textContent).toMatch(/bad data/);
  });

  it("unreadable → blocked, with the cannot-be-read notice", () => {
    fake.data.pair = { ...pairInfo, oracleBadData: undefined };
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("100", "Borrow");
    expect(button("Borrowing blocked").disabled).toBe(true);
    expect(screen.getByTestId("oracle-block-notice").textContent).toMatch(/cannot be read/);
  });

  it("guard blocked → GuardNotice explains, no oracle notice", () => {
    fake.data.guard = describeGuardStatus(4, 0, BOUNDS);
    fake.data.pair = { ...pairInfo, oracleBadData: true };
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    expect(screen.getByText(/Borrow status: REFERENCE_STALE/)).toBeTruthy();
    expect(screen.queryByTestId("oracle-block-notice")).toBeNull();
  });
});
