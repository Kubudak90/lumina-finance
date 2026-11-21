// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ALICE,
  fake,
  hashOf,
  mine,
  resetFake,
  scriptedChain,
  setRead,
  update,
  useFakeVersion,
  type ChainState,
} from "../support/fakeChain";
import { DUAL_USDC_WETH, PAIR_USDC_WETH, USDC, WETH } from "../support/deployment";
import { describeGuardStatus } from "@/lib/guard";
import { repayApproval, repayHeadroom, vaultToAmount, walletBoundedShares } from "@/lib/approvals";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
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
vi.mock("@/hooks/useGuardStatus", () => ({
  useGuardStatus: () => {
    useFakeVersion();
    return { ...(fake.data.guard as object), isLoading: false };
  },
}));

import { IsolatedBorrowModal } from "@/components/actions/IsolatedBorrowModal";
import { IsolatedRepayModal } from "@/components/actions/IsolatedRepayModal";
import { IsolatedLiquidateModal } from "@/components/actions/IsolatedLiquidateModal";
import { IsolatedWithdrawModal } from "@/components/actions/IsolatedWithdrawModal";

const BOUNDS = { maxRefAgeSec: 180, maxDeviationBps: 300, maxCorePriceAgeSec: 600 };
const RATE = 5n * 10n ** 26n; // WETH per USDC × 1e18 (ETH = $2000)
const BORROWER = "0x00000000000000000000000000000000000B0Bb0" as const;

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

const position = (borrowedShares: bigint, borrowedAssets: bigint | undefined) => ({
  ...pairInfo,
  suppliedShares: 0n,
  suppliedAssets: 0n,
  borrowedShares,
  borrowedAssets,
  collateralAmount: 10n ** 18n,
});

let chain: ChainState;

beforeEach(() => {
  resetFake();
  fake.data.pair = pairInfo;
  fake.data.positionState = { status: "known", position: position(0n, 0n) };
  fake.data.guard = describeGuardStatus(0, 0, BOUNDS);
  setRead(USDC, "balanceOf", 10_000_000_000n);
  setRead(WETH, "balanceOf", 10n ** 18n);
  setRead(USDC, "allowance", 10n ** 15n);
  setRead(WETH, "allowance", 10n ** 18n);
  // What the chain itself returns to fresh reads right before a send.
  chain = {
    snapshots: { [ALICE.toLowerCase()]: [0n, 0n, 10n ** 18n] },
    perShare: 1_000_000n, // 1 share = 1 USDC
    allowance: 10n ** 15n,
    wallet: 10_000_000_000n,
    guardStatus: 0,
    oracleBadData: false,
    rate: RATE,
    maxLtv: 75_000n,
    accounting: [1_000_000_000_000n, 1_000_000_000_000n, 0n, 0n, 0n],
    borrowLimit: (1n << 200n) - 1n,
    maxRedeem: 0n,
  };
  fake.multicall = scriptedChain(chain);
});
afterEach(() => cleanup());

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("IsolatedBorrowModal (Codex #8, Gemini r2 M3/M4)", () => {
  it("the polled guard turns stale while the modal is open → Borrow is disabled", async () => {
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "100" } });
    expect(button("Borrow USDC").disabled).toBe(false);
    await act(async () =>
      update((f) => {
        f.data.guard = describeGuardStatus(4, 0, BOUNDS);
        f.data.pair = { ...pairInfo, oracleBadData: true };
      }),
    );
    expect(button("Borrowing blocked").disabled).toBe(true);
  });

  it("a guard-only poll transition also disables Borrow", async () => {
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "100" } });
    await act(async () => update((f) => (f.data.guard = describeGuardStatus(4, 0, BOUNDS))));
    expect(button("Borrowing blocked").disabled).toBe(true);
  });

  it("after the approval, reads the guard from the chain: tripped on-chain (poll still OK) → no borrow", async () => {
    setRead(WETH, "allowance", 0n);
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Collateral"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "100" } });
    await act(async () => fireEvent.click(button("Approve WETH")));
    expect(fake.sends[0].args).toEqual([PAIR_USDC_WETH, 5n * 10n ** 17n]); // exact collateral
    chain.guardStatus = 4; // REFERENCE_STALE on-chain; the poll has not seen it yet
    chain.allowance = 5n * 10n ** 17n;
    chain.wallet = 10n ** 18n; // everything else would allow the borrow: only the guard blocks it
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve"]);
    expect(screen.getByText(/Borrowing became blocked/)).toBeTruthy();
    expect(fake.freshReads.map((c) => c.functionName)).toEqual(expect.arrayContaining(["borrowStatus", "getPrices", "getUserSnapshot", "allowance"]));
  });

  it("after the approval, a fresh chain state that still fits → the borrow is sent", async () => {
    setRead(WETH, "allowance", 0n);
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Collateral"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "100" } });
    await act(async () => fireEvent.click(button("Approve WETH")));
    chain.allowance = 5n * 10n ** 17n;
    chain.wallet = 10n ** 18n; // 1 WETH of collateral in the wallet
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "borrowAsset", args: [100_000_000n, 5n * 10n ** 17n, ALICE] });
  });

  it("an unknown position (snapshot failed or loading) makes MAX unavailable and Borrow disabled", () => {
    fake.data.positionState = { status: "unknown", position: undefined };
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Collateral"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "100" } });
    expect(screen.getByTestId("borrow-max").textContent).toBe("unavailable");
    expect(screen.getByTestId("position-unknown")).toBeTruthy();
    expect(button("Borrow USDC").disabled).toBe(true);
  });
});

describe("IsolatedRepayModal (Codex #8, Gemini r2 M1/M2/M3)", () => {
  beforeEach(() => {
    fake.data.positionState = { status: "known", position: position(100n, 100_000_000n) };
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 100_000_000n);
    chain.snapshots[ALICE.toLowerCase()] = [0n, 100n, 10n ** 18n];
  });

  it("shares drop from 100 to 50 in the poll → MAX repays 50", async () => {
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(button("MAX"));
    chain.snapshots[ALICE.toLowerCase()] = [0n, 50n, 10n ** 18n];
    await act(async () =>
      update((f) => {
        f.data.positionState = { status: "known", position: position(50n, 50_000_000n) };
        f.reads.set(`${PAIR_USDC_WETH.toLowerCase()}:toBorrowAmount`, 50_000_000n);
      }),
    );
    await act(async () => fireEvent.click(button("Repay USDC")));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "repayAsset", args: [50n, ALICE] });
  });

  it("shares change ON-CHAIN during the approval (poll still 100) → the follow-up repays the new 50", async () => {
    setRead(USDC, "allowance", 0n);
    chain.allowance = 0n;
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(button("MAX"));
    await act(async () => fireEvent.click(button("Approve USDC")));
    expect(fake.sends[0].args).toEqual([PAIR_USDC_WETH, repayApproval(100_000_000n)]);
    // Another session repays 50 shares; the poll has not refreshed.
    chain.snapshots[ALICE.toLowerCase()] = [0n, 50n, 10n ** 18n];
    chain.allowance = repayApproval(100_000_000n);
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "repayAsset", args: [50n, ALICE] });
  });

  it("accrual between approve and send stays within the headroom → still repays (Gemini r2 C1/M1)", async () => {
    setRead(USDC, "allowance", 0n);
    chain.allowance = 0n;
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(button("MAX"));
    await act(async () => fireEvent.click(button("Approve USDC")));
    chain.allowance = repayApproval(100_000_000n);
    chain.perShare = 1_000_016n; // one block of interest: 100 shares now worth 100.0016 USDC
    await act(async () => mine(hashOf(1)));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "repayAsset", args: [100n, ALICE] });
  });

  it("a wallet without headroom is refused before approval and offered a wallet-bounded share repay", async () => {
    // Realistic share scale (VaultAccount virtual offsets make 1 share ≈ 1 raw unit here).
    const totals = { amount: 100_000_000n, shares: 100_000_000n };
    update((f) => {
      f.data.pair = { ...pairInfo, totalBorrowAmount: totals.amount, totalBorrowShares: totals.shares };
      f.data.positionState = { status: "known", position: position(100_000_000n, 100_000_000n) };
    });
    setRead(USDC, "balanceOf", 100_000_000n); // exactly the value: no accrual margin
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(button("MAX"));
    expect(button("Repay USDC").disabled).toBe(true);
    const offer = walletBoundedShares(100_000_000n, totals, 100_000_000n);
    expect(offer).toBeGreaterThan(0n);
    expect(offer).toBeLessThan(100_000_000n);
    expect(repayHeadroom(vaultToAmount(totals, offer, true))).toBeLessThanOrEqual(100_000_000n);
    const offerButton = screen.getByRole("button", { name: new RegExp(`Repay ${offer} shares instead`) });
    // Taking the offer switches to exactly those shares, and that repay goes out.
    setRead(PAIR_USDC_WETH, "toBorrowAmount", vaultToAmount(totals, offer, true));
    chain.snapshots[ALICE.toLowerCase()] = [0n, 100_000_000n, 10n ** 18n];
    chain.perShare = 1n; // 1 share = 1 raw unit at this scale
    chain.wallet = 100_000_000n;
    fireEvent.click(offerButton);
    expect(button("Repay USDC").disabled).toBe(false);
    await act(async () => fireEvent.click(button("Repay USDC")));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "repayAsset", args: [offer, ALICE] });
  });

  it("typed shares above the borrow shares are refused (Gemini r2 M2)", () => {
    setRead(PAIR_USDC_WETH, "toBorrowShares", 150n); // 150 USDC buys 150 shares > 100
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "150" } });
    expect(screen.getByTestId("share-bound-error")).toBeTruthy();
    expect(button(/USDC/).disabled).toBe(true);
  });

  it("re-checks the shares on-chain: fewer than selected → nothing sent", async () => {
    setRead(PAIR_USDC_WETH, "toBorrowShares", 80n);
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 80_000_000n);
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "80" } });
    chain.snapshots[ALICE.toLowerCase()] = [0n, 60n, 10n ** 18n]; // repaid elsewhere
    await act(async () => fireEvent.click(button("Repay USDC")));
    await act(async () => {});
    expect(fake.sends).toHaveLength(0);
    expect(screen.getByTestId("repay-notice").textContent).toMatch(/now owe 60 shares/);
  });

  it("says the typed amount is an estimate before approval (Codex #6)", () => {
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    expect(screen.getByTestId("share-estimate").textContent).toMatch(/Estimate/);
  });
});

describe("IsolatedLiquidateModal (Gemini r2 M1/M2/M3)", () => {
  const renderLiq = (shares = 100n) =>
    render(
      <IsolatedLiquidateModal
        pair={PAIR_USDC_WETH}
        asset={USDC}
        assetSymbol="USDC"
        assetDecimals={6}
        collateralSymbol="WETH"
        collateralDecimals={18}
        borrower={BORROWER}
        borrowerDebtAsset={shares * 1_000_000n}
        borrowerDebtShares={shares}
        borrowerCollateral={10n ** 17n}
        onClose={() => {}}
      />,
    );

  beforeEach(() => {
    chain.snapshots[BORROWER.toLowerCase()] = [0n, 100n, 10n ** 17n];
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 100_000_000n);
    // The modal re-checks the borrower's solvency on-chain before sending (U2 r1 #3): 70–100 USDC
    // of debt against 0.1 WETH ($200) is 35–50% LTV, so the scripted pair's max LTV must be below it.
    chain.maxLtv = 30_000n;
  });

  it("wallet equal to the share value is not enough: the headroom is required", () => {
    setRead(USDC, "balanceOf", 100_000_000n);
    renderLiq();
    fireEvent.click(button("MAX"));
    expect(button("Liquidate").disabled).toBe(true);
  });

  it("typed shares above the borrower's debt shares are refused", () => {
    setRead(PAIR_USDC_WETH, "toBorrowShares", 150n);
    renderLiq();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "150" } });
    expect(screen.getByTestId("share-bound-error")).toBeTruthy();
    expect(button(/Liquidate|Approve/).disabled).toBe(true);
  });

  it("MAX liquidates the borrower's shares as read on-chain at send time", async () => {
    renderLiq();
    fireEvent.click(button("MAX"));
    chain.snapshots[BORROWER.toLowerCase()] = [0n, 70n, 10n ** 17n]; // partly repaid meanwhile
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "liquidate" });
    expect(fake.sends.at(-1)?.args?.[0]).toBe(70n);
    expect(fake.sends.at(-1)?.args?.[2]).toBe(BORROWER);
  });
});

describe("IsolatedWithdrawModal (Gemini r2 m4)", () => {
  it("MAX redeems the whole share balance read on-chain", async () => {
    setRead(PAIR_USDC_WETH, "maxWithdraw", 100_000_000n);
    chain.snapshots[ALICE.toLowerCase()] = [95_000_000n, 0n, 0n];
    chain.maxRedeem = 95_000_000n;
    render(<IsolatedWithdrawModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(button("MAX"));
    await act(async () => fireEvent.click(button("Withdraw USDC")));
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "redeem", args: [95_000_000n, ALICE, ALICE] });
  });

  it("shows '—', not 0, when maxWithdraw is unavailable", () => {
    render(<IsolatedWithdrawModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    expect(screen.getByTestId("withdraw-available").textContent).toBe("—");
    expect(button("MAX").disabled).toBe(true);
  });
});
