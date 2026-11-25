// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
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
import { ISOLATED_LIQ_GAS_PADDING, isolatedLiquidationMax } from "@/lib/liquidation";

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
  lowExchangeRate: RATE,
  cleanLiquidationFee: 5_000n,
  dirtyLiquidationFee: 4_500n,
  protocolLiquidationFee: 10_000n,
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
    // The modal's own position read fails too (U4 r1 #3: the form reads it, not the poll cache).
    const scripted = fake.multicall;
    fake.multicall = (calls) =>
      scripted(calls)?.map((r, i) => (calls[i].functionName === "getUserSnapshot" ? { status: "failure" as const, error: new Error("snapshot failed") } : r));
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
    // The modal's own read must agree with that poll (U4 r1 #3: the form reads the chain).
    chain.accounting = [1_000_000_000_000n, 1_000_000_000_000n, totals.amount, totals.shares, 0n];
    chain.snapshots[ALICE.toLowerCase()] = [0n, 100_000_000n, 10n ** 18n];
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

  it("shows the repaid amount from the mined RepayAsset event, not the typed input (F3)", async () => {
    const repayEventAbi = parseAbi([
      "event RepayAsset(address indexed payer, address indexed borrower, uint256 amountToRepay, uint256 shares)",
    ]);
    setRead(PAIR_USDC_WETH, "toBorrowShares", 80n);
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 80_000_000n);
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "80" } });
    await act(async () => fireEvent.click(button("Repay USDC")));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "repayAsset", args: [80n, ALICE] });

    // Contract capped shares (e.g. a third party repaid part of the debt before inclusion):
    // mined RepayAsset event reports 37.5 USDC (37_500_000 base units), 37 shares.
    const aliceLc = ALICE.toLowerCase() as `0x${string}`;
    const topics = encodeEventTopics({
      abi: repayEventAbi,
      eventName: "RepayAsset",
      args: { payer: aliceLc, borrower: aliceLc },
    }) as `0x${string}`[];
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [37_500_000n, 37n]);
    await act(async () => mine(hashOf(1), "success", 101n, [{ address: PAIR_USDC_WETH, topics, data }]));

    const success = screen.getByTestId("tx-success");
    expect(success.textContent).toContain("Repaid 37.5 USDC");
    expect(success.textContent).not.toContain("~80");
    expect(success.textContent).not.toContain("80 USDC");
  });

  it("never falls back to the typed input when no RepayAsset log is in the receipt (F3)", async () => {
    setRead(PAIR_USDC_WETH, "toBorrowShares", 80n);
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 80_000_000n);
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "80" } });
    await act(async () => fireEvent.click(button("Repay USDC")));
    await act(async () => {});
    await act(async () => mine(hashOf(1), "success", 101n, []));

    const success = screen.getByTestId("tx-success");
    expect(success.textContent).toContain("Debt repaid");
    expect(success.textContent).not.toContain("~80");
    expect(success.textContent).not.toContain("80 USDC");
  });
});

describe("IsolatedLiquidateModal (Gemini r2 M1/M2/M3, F2, F8)", () => {
  const E6 = 10n ** 6n;
  const E18 = 10n ** 18n;

  const renderLiq = (opts?: {
    shares?: bigint;
    debt?: bigint;
    collateral?: bigint;
    rate?: bigint;
    totalBorrow?: { amount: bigint; shares: bigint };
  }) => {
    const shares = opts?.shares ?? 100n * E6;
    const debt = opts?.debt ?? shares;
    const collateral = opts?.collateral ?? 10n ** 17n; // 0.1 WETH ($200 at $2000/ETH)
    const rate = opts?.rate ?? RATE;
    const tb = opts?.totalBorrow ?? { amount: shares, shares };
    fake.data.pair = {
      ...pairInfo,
      totalBorrowAmount: tb.amount,
      totalBorrowShares: tb.shares,
      exchangeRate: rate,
      lowExchangeRate: rate,
    };
    chain.snapshots[BORROWER.toLowerCase()] = [0n, shares, collateral];
    chain.accounting = [1_000_000_000_000n, 1_000_000_000_000n, tb.amount, tb.shares, collateral];
    chain.rate = rate;
    return render(
      <IsolatedLiquidateModal
        pair={PAIR_USDC_WETH}
        asset={USDC}
        assetSymbol="USDC"
        assetDecimals={6}
        collateralSymbol="WETH"
        collateralDecimals={18}
        borrower={BORROWER}
        borrowerDebtAsset={debt}
        borrowerDebtShares={shares}
        borrowerCollateral={collateral}
        onClose={() => {}}
      />,
    );
  };

  beforeEach(() => {
    // 70–100 USDC against 0.1 WETH ($200) is 35–50% LTV, so maxLtv < 35% keeps borrower insolvent.
    chain.maxLtv = 30_000n;
    chain.perShare = 1n;
  });

  it("wallet equal to the share value is not enough: the headroom is required", () => {
    setRead(USDC, "balanceOf", 100n * E6);
    renderLiq();
    fireEvent.click(button("MAX"));
    expect(button("Liquidate").disabled).toBe(true);
  });

  it("typed shares above the borrower's debt shares are refused", () => {
    setRead(PAIR_USDC_WETH, "toBorrowShares", 150n * E6);
    renderLiq();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "150" } });
    expect(screen.getByTestId("share-bound-error")).toBeTruthy();
    expect(button(/Liquidate|Approve/).disabled).toBe(true);
  });

  it("MAX liquidates the borrower's shares as read on-chain at send time, with 120s deadline and F2 gas padding", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    renderLiq();
    fireEvent.click(button("MAX"));
    chain.snapshots[BORROWER.toLowerCase()] = [0n, 70n * E6, 10n ** 17n]; // partly repaid meanwhile
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    const sent = fake.sends.at(-1);
    expect(sent).toMatchObject({ functionName: "liquidate", gasPadding: ISOLATED_LIQ_GAS_PADDING });
    expect(sent?.args?.[0]).toBe(70n * E6);
    expect(sent?.args?.[2]).toBe(BORROWER);
    const deadline = sent?.args?.[1] as bigint;
    expect(deadline).toBeGreaterThanOrEqual(BigInt(nowSec + 115));
    expect(deadline).toBeLessThanOrEqual(BigInt(nowSec + 130));
  });

  it("underwater position: MAX picks the largest clean amount inside the 1% margin, never full debt (N-FE-01 / F8)", async () => {
    // 3,000 USDC debt, 1 WETH collateral at ETH = $2,800 (underwater).
    const rate = (10n ** 30n) / 2_800n;
    const expected = isolatedLiquidationMax({
      borrowerShares: 3_000n * E6,
      collateral: E18,
      totalBorrow: { amount: 3_000n * E6, shares: 3_000n * E6 },
      exchangeRate: rate,
      cleanLiquidationFee: 5_000n,
      dirtyLiquidationFee: 4_500n,
      protocolLiquidationFee: 10_000n,
    });
    expect(expected.mode).toBe("clean");
    expect(expected.shares).toBeLessThan(3_000n * E6);

    renderLiq({ shares: 3_000n * E6, debt: 3_000n * E6, collateral: E18, rate });
    fireEvent.click(button("MAX"));
    expect(button("Liquidate").disabled).toBe(false);
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "liquidate", gasPadding: ISOLATED_LIQ_GAS_PADDING });
    expect(fake.sends.at(-1)?.args?.[0]).toBe(expected.shares);
  });

  it("equity outside the 1% margin: MAX picks the largest dirty partial leaving remainder covered, explains why MAX is small, and still allows manual input (rev 3.1)", async () => {
    // 2,790 USDC debt, 1 WETH collateral at ETH = $2,800 ($10 equity; outside 1% margin).
    const rate = (10n ** 30n) / 2_800n;
    renderLiq({ shares: 2_790n * E6, debt: 2_790n * E6, collateral: E18, rate });
    const reason = screen.getByTestId("dirty-max-reason").textContent ?? "";
    expect(reason).toMatch(/safety margin/i);
    expect(reason).toMatch(/remaining debt uncovered/i);
    fireEvent.click(button("MAX"));
    expect(screen.getByTestId("tx-summary").querySelector('[data-row="Write-off"]')?.textContent).toContain("0 USDC");
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    expect(fake.sends.at(-1)?.args?.[0]).toBe(222_222_222n);
  });

  it("thin equity where no dirty partial keeps remainder covered: MAX is 0 with explanation, user can still type an amount (rev 3.1)", async () => {
    // 1,000 USDC debt, 1 WETH collateral at ETH = $1,000 (exact 100% LTV, 0 equity: has equity, MAX = 0).
    const rate = (10n ** 30n) / 1_000n;
    setRead(PAIR_USDC_WETH, "toBorrowShares", 1_000n * E6);
    renderLiq({ shares: 1_000n * E6, debt: 1_000n * E6, collateral: E18, rate });
    expect(button("MAX").disabled).toBe(true);
    const reason = screen.getByTestId("no-safe-max").textContent ?? "";
    expect(reason).toMatch(/safety margin/i);
    expect(reason).toMatch(/remaining debt uncovered/i);

    // User can still manually type full repayment (which does not exceed collateral received).
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1000" } });
    expect(button("Liquidate").disabled).toBe(false);
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    expect(fake.sends.at(-1)?.args?.[0]).toBe(1_000n * E6);
  });

  it("blocks sending when repayment exceeds collateral received (render-time and send-time price drop)", async () => {
    // Underwater: 3,000 USDC debt, 1 WETH at $2,800. Manually typing 2,900 USDC exceeds collateral ($2,800).
    const rate = (10n ** 30n) / 2_800n;
    setRead(PAIR_USDC_WETH, "toBorrowShares", 2_900n * E6);
    renderLiq({ shares: 3_000n * E6, debt: 3_000n * E6, collateral: E18, rate });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2900" } });
    expect(screen.getByTestId("repayment-exceeds-collateral")).toBeTruthy();
    expect(button(/Liquidate|Approve/).disabled).toBe(true);

    // Price drop at send time: quote was profitable (2,000 USDC vs 1 WETH @ $2,500), then ETH crashes to $1,500 on-chain.
    cleanup();
    const okRate = (10n ** 30n) / 2_500n;
    setRead(PAIR_USDC_WETH, "toBorrowShares", 2_000n * E6);
    renderLiq({ shares: 3_000n * E6, debt: 3_000n * E6, collateral: E18, rate: okRate });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2000" } });
    expect(button("Liquidate").disabled).toBe(false);
    // On-chain price drops to $1,500 right before send: repayment (2,000) > collateral received ($1,500).
    chain.rate = (10n ** 30n) / 1_500n;
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    expect(fake.sends).toHaveLength(0);
    expect(screen.getByTestId("liquidate-notice").textContent).toMatch(/exceeds the collateral/i);
  });

  it("warns and blocks a typed dirty partial within the accrual buffer of the clean boundary on a position with equity (spec rev 3.3)", async () => {
    // Review example: 100,000 USDC debt vs 52.25 WETH ($104,500 at $2,000/ETH), default fees (5% / 4.5% / 10%).
    // Real cleanMin = 99,523,809,524; bufferedCleanMin (+10 bps) = 99,424,385,140.
    const collateral = 52_250_000_000_000_000_000n;
    const debt = 100_000n * E6;
    setRead(USDC, "balanceOf", 200_000n * E6);
    setRead(USDC, "allowance", 200_000n * E6);
    chain.wallet = 200_000n * E6;
    chain.allowance = 200_000n * E6;

    // 1) Typed amount inside the buffer zone (99,523.809523 = realCleanMin - 1): dirty at quote, blocked!
    setRead(PAIR_USDC_WETH, "toBorrowShares", 99_523_809_523n);
    renderLiq({ shares: debt, debt, collateral, rate: RATE });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "99523.809523" } });
    // Quote simulation stays on the real totals (dirty -> 0 USDC write-off) while warning & blocking send:
    expect(screen.getByTestId("tx-summary").querySelector('[data-row="Write-off"]')?.textContent).toContain("0 USDC");
    const warning = screen.getByTestId("clean-buffer-blocked").textContent ?? "";
    expect(warning).toMatch(/clean/i);
    expect(warning).toMatch(/write off/i);
    expect(button(/Liquidate|Approve/).disabled).toBe(true);

    // 2) Lowering below the buffered boundary (99,424 USDC < bufferedCleanMin) unblocks and sends:
    setRead(PAIR_USDC_WETH, "toBorrowShares", 99_424n * E6);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "99424" } });
    expect(screen.queryByTestId("clean-buffer-blocked")).toBeNull();
    expect(button("Liquidate").disabled).toBe(false);
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "liquidate", args: [99_424n * E6, expect.any(BigInt), BORROWER] });

    // 3) Send-time re-check: just below bufferedCleanMin at quote, then 1 block of interest (+318 micro-USDC)
    //    pushes those shares into the clean buffer on-chain -> aborts with notice, sends nothing.
    cleanup();
    fake.sends = [];
    setRead(PAIR_USDC_WETH, "toBorrowShares", 99_424_385_139n); // bufferedCleanMin - 1
    renderLiq({ shares: debt, debt, collateral, rate: RATE });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "99424.385139" } });
    expect(screen.queryByTestId("clean-buffer-blocked")).toBeNull();
    expect(button("Liquidate").disabled).toBe(false);
    chain.accounting = [1_000_000_000_000n, 1_000_000_000_000n, debt + 318n, debt, collateral];
    await act(async () => fireEvent.click(button("Liquidate")));
    await act(async () => {});
    expect(fake.sends).toHaveLength(0);
    expect(screen.getByTestId("liquidate-notice").textContent).toMatch(/clean.*threshold|write off/i);

    // 4) Underwater position near clean boundary is NOT blocked by the equity clean-buffer rule:
    cleanup();
    const uwRate = (10n ** 30n) / 2_800n;
    setRead(PAIR_USDC_WETH, "toBorrowShares", 2_665n * E6); // dirty at quote, within 10 bps of cleanMin (~2,666.67)
    renderLiq({ shares: 3_000n * E6, debt: 3_000n * E6, collateral: E18, rate: uwRate });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2665" } });
    expect(screen.queryByTestId("clean-buffer-blocked")).toBeNull();
    expect(button("Liquidate").disabled).toBe(false);
  });

  it("states that the comparison holds at quote time and does not promise a discount (F8)", () => {
    renderLiq();
    expect(document.body.textContent).toMatch(/quote time/i);
    expect(document.body.textContent).not.toMatch(/with discount/i);
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
