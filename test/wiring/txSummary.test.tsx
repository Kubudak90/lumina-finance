// @vitest-environment happy-dom
/**
 * ui-usability-v1 §6 #3: every one of the 13 modals renders its profile's TxSummary — (a) borrower
 * risk for core Supply / Withdraw / Borrow / Repay / EnableCollateral (on open) and isolated
 * Borrow / Repay / AddCollateral / RemoveCollateral, (b) lender for isolated Lend / Withdraw,
 * (c) liquidation for Liquidate / IsolatedLiquidate — from the real risk maths, with the gauge
 * showing the AFTER value.
 */
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ALICE, fake, resetFake, setRead, useFakeVersion } from "../support/fakeChain";
import { DUAL_USDC_WETH, PAIR_USDC_WETH, USDC, WETH } from "../support/deployment";
import { D_USDC, defaultTxChain, txChain, type TxChainState } from "../support/txChain";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
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

import { SupplyModal } from "@/components/actions/SupplyModal";
import { WithdrawModal } from "@/components/actions/WithdrawModal";
import { BorrowModal } from "@/components/actions/BorrowModal";
import { RepayModal } from "@/components/actions/RepayModal";
import { EnableCollateralModal } from "@/components/actions/EnableCollateralModal";
import { IsolatedBorrowModal } from "@/components/actions/IsolatedBorrowModal";
import { IsolatedRepayModal } from "@/components/actions/IsolatedRepayModal";
import { IsolatedAddCollateralModal } from "@/components/actions/IsolatedAddCollateralModal";
import { IsolatedRemoveCollateralModal } from "@/components/actions/IsolatedRemoveCollateralModal";
import { IsolatedLendModal } from "@/components/actions/IsolatedLendModal";
import { IsolatedWithdrawModal } from "@/components/actions/IsolatedWithdrawModal";
import { LiquidateModal } from "@/components/actions/LiquidateModal";
import { IsolatedLiquidateModal } from "@/components/actions/IsolatedLiquidateModal";

const RATE = 5n * 10n ** 26n; // WETH per USDC × 1e18 ($2000 / ETH)
const BORROWER = "0x00000000000000000000000000000000000B0Bb0" as const;
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
  lowExchangeRate: RATE,
  cleanLiquidationFee: 5_000n,
  dirtyLiquidationFee: 4_500n,
  protocolLiquidationFee: 10_000n,
  oracleBadData: false as boolean | undefined,
  loaded: true,
};

let chain: TxChainState;

beforeEach(() => {
  resetFake();
  chain = defaultTxChain();
  // Core: 1 WETH collateral (LT 80%), 1,000 USDC debt → HF 1.60.
  chain.accounts[lc(ALICE)] = { supplied: { [lc(WETH)]: 10n ** 18n }, borrowed: { [lc(USDC)]: 1_000_000_000n }, collateral: { [lc(WETH)]: true } };
  // Isolated: 100 borrow shares = 100 USDC against 1 WETH (LTV 5%); 50 USDC lent.
  chain.accounting = [1_000_000_000_000n, 1_000_000_000_000n, 100_000_000n, 100_000_000n, 10n ** 18n];
  chain.snapshots[lc(ALICE)] = [50_000_000n, 100_000_000n, 10n ** 18n];
  fake.multicall = txChain(chain);
  fake.data.pair = pairInfo;
  fake.data.positionState = {
    status: "known",
    position: { ...pairInfo, suppliedShares: 50_000_000n, suppliedAssets: 50_000_000n, borrowedShares: 100_000_000n, borrowedAssets: 100_000_000n, collateralAmount: 10n ** 18n },
  };
  setRead(WETH, "balanceOf", 10n * 10n ** 18n);
  setRead(USDC, "balanceOf", 10_000_000_000n);
  setRead(WETH, "allowance", 10n ** 24n);
  setRead(USDC, "allowance", 10n ** 24n);
  setRead(D_USDC, "balanceOf", 1_000_000_000n);
});
afterEach(() => cleanup());

const summary = () => screen.getByTestId("tx-summary");
const row = (label: string) => summary().querySelector(`[data-row^="${label}"]`)?.textContent ?? "";
const gauge = () => within(summary()).getByRole("meter").getAttribute("aria-valuetext");
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("profile (a), core: HF / borrow limit / liquidation price / APY, gauge = after", () => {
  it("Supply: 1 WETH more → HF 1.60 → 3.20 (first-supply rules from lib/risk)", () => {
    render(<SupplyModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    expect(screen.queryByTestId("tx-summary")).toBeNull(); // shown once an amount is entered
    type("Amount", "1");
    expect(summary().dataset.profile).toBe("core");
    expect(row("Health factor")).toContain("1.60 → 3.20");
    expect(gauge()).toBe("3.20, Safe");
    expect(row("Borrow limit used")).toContain("66.66% → 33.33%");
    expect(row("Liquidation price")).toContain("ETH below $1,250.00 → ETH below $625.00");
    // 3% APR → APY 3.0454…%: the one APY formatter (lib/format formatApy) rounds half-up (U4 r1 #1).
    expect(row("Supply APY")).toMatch(/3\.05%/);
  });

  it("Withdraw: 0.5 WETH → HF 0.80, the gauge reads Liquidatable", () => {
    render(<WithdrawModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    type("Amount", "0.5");
    expect(row("Health factor")).toContain("1.60 → 0.80");
    expect(gauge()).toBe("0.80, Liquidatable");
    expect(within(summary()).getByText(/can be liquidated/)).toBeTruthy();
  });

  it("Withdraw over the balance: the preview is still shown, marked invalid, and the button is disabled", () => {
    render(<WithdrawModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />);
    type("Amount", "2");
    expect(screen.getByTestId("tx-summary-invalid")).toBeTruthy();
    expect(row("Health factor")).toContain("1.60 → 0.00");
    expect((screen.getByRole("button", { name: "Withdraw WETH" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Borrow: 200 USDC → HF 1.33 (warning), borrow APY", () => {
    render(<BorrowModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    type("Amount", "200");
    expect(row("Health factor")).toContain("1.60 → 1.33");
    expect(gauge()).toBe("1.33, Warning");
    // 5% APR → APY 5.1271…% → "5.13%", as on every page (U4 r1 #1).
    expect(row("Borrow APY")).toMatch(/5\.13%/);
  });

  it("Repay: 500 USDC → HF 3.20", () => {
    render(<RepayModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    type("Amount", "500");
    expect(summary().dataset.profile).toBe("core");
    expect(row("Health factor")).toContain("1.60 → 3.20");
  });

  it("EnableCollateral shows the summary on open (disable WETH → HF 0.00)", () => {
    render(<EnableCollateralModal asset={WETH} symbol="WETH" currentlyEnabled onClose={() => {}} />);
    expect(summary().dataset.profile).toBe("core");
    expect(row("Health factor")).toContain("1.60 → 0.00");
  });

  it("eMode ≠ 0: every risk figure reads 'unavailable', never 0 (FE-07)", () => {
    chain.eMode = 1n;
    render(<BorrowModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    type("Amount", "200");
    expect(row("Health factor")).toContain("unavailable → unavailable");
    expect(row("Borrow limit used")).toContain("unavailable → unavailable");
    expect(row("Liquidation price")).toContain("unavailable → unavailable");
  });
});

describe("profile (a), isolated: LTV vs max / liquidation price / collateral / debt / APY", () => {
  it("Borrow: +500 USDC → LTV 5.00% → 30.00%, gauge after", () => {
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Borrow", "500");
    expect(summary().dataset.profile).toBe("isolated");
    expect(row("LTV")).toContain("5.00% → 30.00%");
    expect(gauge()).toBe("30.00%, Safe");
    expect(row("Debt")).toContain("100 USDC → 600 USDC");
    expect(row("Collateral")).toContain("1 WETH → 1 WETH");
    expect(row("Liquidation price")).toMatch(/ETH below 133\.33 USDC → ETH below 800\.00 USDC/);
  });

  it("Repay (share-based): MAX → debt 0, LTV 0%, liquidation price none", () => {
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 100_000_000n);
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(summary().dataset.profile).toBe("isolated");
    expect(row("Debt")).toContain("100 USDC → 0 USDC");
    expect(row("LTV")).toContain("5.00% → 0.00%");
    expect(row("Liquidation price")).toContain("→ none");
  });

  it("AddCollateral: +1 WETH → LTV 5.00% → 2.50%", () => {
    render(<IsolatedAddCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "1");
    expect(summary().dataset.profile).toBe("isolated");
    expect(row("LTV")).toContain("5.00% → 2.50%");
  });

  it("RemoveCollateral: all of it while in debt → LTV ∞, liquidation 'now'", () => {
    render(<IsolatedRemoveCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(summary().dataset.profile).toBe("isolated");
    expect(row("LTV")).toContain("5.00% → ∞");
    expect(gauge()).toBe("∞, Liquidatable");
    expect(row("Liquidation price")).toContain("→ now");
  });
});

describe("profile (b), lender: lent balance and lend APY", () => {
  it("Lend: 50 → 60 USDC", () => {
    render(<IsolatedLendModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "10");
    expect(summary().dataset.profile).toBe("lender");
    expect(row("Lent balance")).toContain("50 USDC → 60 USDC");
    expect(row("Lend APY")).toContain("unavailable"); // the fixture pair has no rate reads
  });

  it("Withdraw: 50 → 30 USDC", () => {
    setRead(PAIR_USDC_WETH, "maxWithdraw", 50_000_000n);
    render(<IsolatedWithdrawModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    type("Amount", "20");
    expect(summary().dataset.profile).toBe("lender");
    expect(row("Lent balance")).toContain("50 USDC → 30 USDC");
  });
});

describe("profile (c), liquidation: debt repaid and the borrower's remaining position, never the liquidator's HF", () => {
  it("Liquidate: 50 of the borrower's 100 USDC against 1 WETH", () => {
    render(
      <LiquidateModal
        borrower={BORROWER}
        debtAsset={USDC}
        debtSymbol="USDC"
        debtDecimals={6}
        collateralAsset={WETH}
        collateralSymbol="WETH"
        collateralDecimals={18}
        borrowerDebt={100_000_000n}
        borrowerCollateral={10n ** 18n}
        maxDebt={100_000_000n}
        closeFactorBps={10_000n}
        collateralLimited={false}
        liquidatable
        onClose={() => {}}
      />,
    );
    type("Amount", "50");
    expect(summary().dataset.profile).toBe("liquidation");
    expect(row("Debt repaid")).toContain("50 USDC");
    expect(row("Borrower debt")).toContain("100 USDC → 50 USDC");
    // 50 USDC at $2000 = 0.025 WETH, × 1.05 bonus = 0.02625 WETH seized.
    expect(row("Borrower collateral")).toContain("1 WETH → 0.9737 WETH");
    expect(within(summary()).queryByText(/Health factor/)).toBeNull();
    expect(within(summary()).queryByRole("meter")).toBeNull();
  });

  it("IsolatedLiquidate: shows repayment, collateral seized, protocol fee, collateral received and write-off as separate lines (F8)", () => {
    // 100 USDC (100e6 shares = 100 USDC) against 0.1 WETH ($200 at $2,000/ETH) → dirty path (+4.5% fee, 10% protocol share of bonus).
    // base = 0.05 WETH; seized = 0.05225 WETH; protocolFee = 0.000225 WETH; received = 0.052025 WETH; writeOff = 0.
    // Borrower collateral left = 0.1 - 0.05225 = 0.04775 WETH (formatted down to 4 places: 0.0477 WETH).
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
        borrowerDebtShares={100_000_000n}
        borrowerCollateral={10n ** 17n}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(summary().dataset.profile).toBe("liquidation");
    expect(row("Repayment")).toContain("100 USDC");
    expect(row("Collateral seized")).toContain("0.0522 WETH");
    expect(row("Protocol fee")).toContain("0.0002 WETH");
    expect(row("Collateral received")).toContain("0.052 WETH");
    expect(row("Write-off")).toContain("0 USDC");
    expect(row("Borrower debt")).toContain("100 USDC → 0 USDC");
    expect(row("Borrower collateral")).toContain("0.1 WETH → 0.0477 WETH");
    expect(within(summary()).queryByRole("meter")).toBeNull();
  });
});

describe("context: FreshnessStamp in every risk-changing modal, GuardNotice only in the guard-gated ones", () => {
  const riskModals: Array<[string, () => ReactElement]> = [
    ["Supply", () => <SupplyModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />],
    ["Withdraw", () => <WithdrawModal asset={WETH} symbol="WETH" decimals={18} onClose={() => {}} />],
    ["Borrow", () => <BorrowModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />],
    ["Repay", () => <RepayModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />],
    ["EnableCollateral", () => <EnableCollateralModal asset={WETH} symbol="WETH" currentlyEnabled onClose={() => {}} />],
    ["IsolatedBorrow", () => <IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />],
    ["IsolatedRepay", () => <IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />],
    ["IsolatedAddCollateral", () => <IsolatedAddCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />],
    ["IsolatedRemoveCollateral", () => <IsolatedRemoveCollateralModal pair={PAIR_USDC_WETH} onClose={() => {}} />],
  ];

  it.each(riskModals)("%s shows when its position data was read", (_name, element) => {
    render(element());
    expect(screen.getByText(/Position: as of block 100/)).toBeTruthy();
  });

  it("with the guard blocking, only Borrow, IsolatedBorrow and IsolatedRemoveCollateral (in debt) show GuardNotice", () => {
    chain.guardStatus = 4; // REFERENCE_STALE
    const withNotice = new Set(["Borrow", "IsolatedBorrow", "IsolatedRemoveCollateral"]);
    for (const [name, element] of riskModals) {
      const view = render(element());
      expect(screen.queryByText(/Borrow status: REFERENCE_STALE/) !== null, name).toBe(withNotice.has(name));
      view.unmount();
    }
  });
});

