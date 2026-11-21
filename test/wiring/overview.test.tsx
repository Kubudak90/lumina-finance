// @vitest-environment happy-dom
/**
 * ui-usability-v1 U3 (spec §3.3, §6 #4): the dashboard and the portfolio show the same
 * accountTotals(); "Your positions" has core supply, core borrow, isolated lend and isolated
 * borrow/collateral rows (incl. collateral-only) whose actions open the existing modals; the risk
 * card's priority and overall status; the "Pool net" label is gone and Lighter sits behind a
 * remembered toggle; APY cells show aprToApy on every page; the isolated page has APY columns.
 *
 * The data hooks are mocked with fixtures (their own wiring is covered in dataHooks / riskReads);
 * the modals are stubs that record their props, so these tests pin the pages, not the modals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import Decimal from "decimal.js";
import { fake, resetFake, update, useFakeVersion } from "../support/fakeChain";
import { DUAL_USDC_WETH, DUAL_WETH_USDC, PAIR_USDC_WETH, PAIR_WETH_USDC, USDC, WETH } from "../support/deployment";

const params = vi.hoisted(() => ({ asset: "usdc" }));
const router = vi.hoisted(() => ({ push: (() => {}) as (href: string) => void }));

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("@/lib/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chains")>()),
  rpcUrlFor: () => "https://rpc.test",
}));
vi.mock("next/navigation", () => ({ useParams: () => params, usePathname: () => "/", useRouter: () => router }));
vi.mock("@/lib/portfolio/clock", () => ({ useFreshnessNow: () => 1_700_000_100_000 }));
vi.mock("@/hooks/useGuardStatus", () => ({ useGuardStatus: () => ({ key: "OK", borrowAllowed: true, message: "", marketId: 0, isLoading: false }) }));
vi.mock("@/components/markets/RateCurveChart", () => ({ RateCurveChart: () => <div data-testid="rate-curve" /> }));

// accountTotals() wrapped in a spy: the pages must show exactly what it returns.
vi.mock("@/lib/portfolio/combine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portfolio/combine")>();
  return { ...actual, accountTotals: vi.fn(actual.accountTotals) };
});

// Data hooks → fixtures in fake.data (re-rendered on update()).
vi.mock("@/hooks/useUserPosition", () => ({
  useUserPosition: () => {
    useFakeVersion();
    return fake.data.core;
  },
}));
vi.mock("@/hooks/useUserIsolatedPositions", () => ({
  useUserIsolatedPositions: () => {
    useFakeVersion();
    return fake.data.iso;
  },
}));
vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => {
    useFakeVersion();
    const markets = fake.data.markets as { asset: string }[];
    return { markets, getMarket: (a: string) => markets.find((m) => m.asset.toLowerCase() === a.toLowerCase()), isLoading: false };
  },
}));
vi.mock("@/hooks/useOraclePrices", () => ({
  useOraclePrices: () => ({
    priceOf: (a: string | undefined) =>
      a?.toLowerCase() === WETH.toLowerCase() ? 2_000n * 10n ** 8n : a?.toLowerCase() === USDC.toLowerCase() ? 10n ** 8n : undefined,
    stamp: { number: 990n, timestamp: 1_700_000_080n },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useIsolatedPairs", () => ({
  useIsolatedPairs: () => {
    useFakeVersion();
    return { pairs: fake.data.pairs, stamp: undefined, isLoading: false };
  },
}));
vi.mock("@/components/layout/Sidebar", () => ({ Sidebar: () => <nav /> }));
vi.mock("@/components/layout/Header", () => ({ Header: () => <header /> }));
vi.mock("@/components/layout/NetworkGuard", () => ({ NetworkGuard: () => null }));
vi.mock("@/components/layout/RpcChainBanner", () => ({ RpcChainBanner: () => null }));
vi.mock("@/hooks/useUserCollateralStatus", () => ({ useUserCollateralStatus: () => ({ isCollateralEnabled: () => true, isLoading: false }) }));

// Modals: stubs that record which one opened and with what props.
const stub = vi.hoisted(() => (name: string) => {
  return function Modal(props: Record<string, unknown>) {
    const shown = Object.fromEntries(
      Object.entries(props).filter(([, v]) => typeof v !== "function").map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
    );
    return (
      <div data-testid="modal" data-name={name} data-props={JSON.stringify(shown)}>
        <button type="button" onClick={props.onClose as () => void}>
          close-modal
        </button>
      </div>
    );
  };
});
vi.mock("@/components/actions/SupplyModal", () => ({ SupplyModal: stub("SupplyModal") }));
vi.mock("@/components/actions/WithdrawModal", () => ({ WithdrawModal: stub("WithdrawModal") }));
vi.mock("@/components/actions/BorrowModal", () => ({ BorrowModal: stub("BorrowModal") }));
vi.mock("@/components/actions/RepayModal", () => ({ RepayModal: stub("RepayModal") }));
vi.mock("@/components/actions/EnableCollateralModal", () => ({ EnableCollateralModal: stub("EnableCollateralModal") }));
vi.mock("@/components/actions/IsolatedLendModal", () => ({ IsolatedLendModal: stub("IsolatedLendModal") }));
vi.mock("@/components/actions/IsolatedWithdrawModal", () => ({ IsolatedWithdrawModal: stub("IsolatedWithdrawModal") }));
vi.mock("@/components/actions/IsolatedBorrowModal", () => ({ IsolatedBorrowModal: stub("IsolatedBorrowModal") }));
vi.mock("@/components/actions/IsolatedRepayModal", () => ({ IsolatedRepayModal: stub("IsolatedRepayModal") }));
vi.mock("@/components/actions/IsolatedAddCollateralModal", () => ({ IsolatedAddCollateralModal: stub("IsolatedAddCollateralModal") }));
vi.mock("@/components/actions/IsolatedRemoveCollateralModal", () => ({ IsolatedRemoveCollateralModal: stub("IsolatedRemoveCollateralModal") }));

// The Lighter embed (dynamic, ssr: false) → a stub; next/dynamic → React.lazy.
vi.mock("@/lib/lighter/runtime/session", () => ({
  LighterPortfolioEmbed: ({ lumina }: { lumina: { poolSupplyUsd: number } }) => (
    <div data-testid="lighter-embed">Lumina pool supply {lumina.poolSupplyUsd}</div>
  ),
}));
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<React.ComponentType<Record<string, unknown>>>) => {
      const Lazy = React.lazy(async () => ({ default: await loader() }));
      return function Dynamic(props: Record<string, unknown>) {
        return React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
      };
    },
  };
});

import Dashboard from "@/app/(app)/dashboard/page";
import PortfolioPage from "@/app/(app)/portfolio/page";
import IsolatedPage from "@/app/(app)/isolated/page";
import MarketsPage from "@/app/(app)/markets/page";
import MarketDetailPage from "@/app/(app)/markets/[asset]/page";
import AppLayout from "@/app/(app)/layout";
import { accountTotals } from "@/lib/portfolio/combine";
import { formatApy, formatUsd8 } from "@/lib/format";
import { SHOW_LIGHTER_KEY } from "@/components/portfolio/LighterToggle";

// ---------------------------------------------------------------------------------------------
// Fixtures: 10,000 USDC supplied (collateral) and 1 WETH borrowed on core; USDC/WETH lent 1,000,
// borrowed 500 against 1 WETH; WETH/USDC collateral only (3,000 USDC posted, debt repaid).
// ---------------------------------------------------------------------------------------------

const E6 = 10n ** 6n;
const E8 = 10n ** 8n;
const E18 = 10n ** 18n;
const ray = (pct: bigint) => pct * 10n ** 25n;
const stamp = (n: bigint) => ({ number: n, timestamp: 1_700_000_000n + n });

/** APR → expected APY text (per-second compounding) and the APR text that must NOT appear. */
const RATES = {
  wethSupply: { apr: 2n, apy: "2.02%" },
  wethBorrow: { apr: 4n, apy: "4.08%" },
  usdcSupply: { apr: 5n, apy: "5.13%" },
  usdcBorrow: { apr: 8n, apy: "8.33%" },
  p1Lend: { apr: "0.03", apy: "3.05%" },
  p1Borrow: { apr: "0.06", apy: "6.18%" },
  p2Lend: { apr: "0.01", apy: "1.01%" },
  p2Borrow: { apr: "0.04", apy: "4.08%" },
} as const;
const APR_TEXTS = ["2.00%", "4.00%", "5.00%", "8.00%", "3.00%", "6.00%", "1.00%"];

const market = (symbol: "WETH" | "USDC", supply: bigint, borrow: bigint) => ({
  symbol,
  name: symbol === "WETH" ? "Wrapped Ether" : "USD Coin",
  asset: symbol === "WETH" ? WETH : USDC,
  decimals: symbol === "WETH" ? 18 : 6,
  aToken: null,
  variableDebtToken: null,
  totalSupply: 1_000n * (symbol === "WETH" ? E18 : E6),
  totalBorrow: 500n * (symbol === "WETH" ? E18 : E6),
  supplyRate: ray(supply),
  borrowRate: ray(borrow),
  accruedToTreasury: 0n,
  interestRateStrategy: undefined,
  availableLiquidity: 500n,
  borrowCap: 0n,
  supplyCap: 0n,
  totalDebt: 0n,
  config: {
    ltv: 7500,
    liquidationThreshold: symbol === "WETH" ? 8000 : 7800,
    liquidationBonus: 10500,
    reserveFactor: 1000,
    usageAsCollateralEnabled: true,
    borrowingEnabled: true,
    isActive: true,
    isFrozen: false,
  },
  paused: false,
  loaded: true,
});

const pairInfo = (which: "P1" | "P2") => {
  const p1 = which === "P1";
  return {
    name: p1 ? "USDC/WETH" : "WETH/USDC",
    pair: p1 ? PAIR_USDC_WETH : PAIR_WETH_USDC,
    asset: p1 ? USDC : WETH,
    collateral: p1 ? WETH : USDC,
    assetSymbol: p1 ? "USDC" : "WETH",
    collateralSymbol: p1 ? "WETH" : "USDC",
    assetDecimals: p1 ? 6 : 18,
    collateralDecimals: p1 ? 18 : 6,
    dualOracle: p1 ? DUAL_USDC_WETH : DUAL_WETH_USDC,
    deployed: true,
    maxLTV: 75_000n as bigint | undefined,
    totalAssetAmount: 10_000n * (p1 ? E6 : E18),
    totalAssetShares: 10_000n * (p1 ? E6 : E18),
    totalBorrowAmount: 2_000n * (p1 ? E6 : E18),
    totalBorrowShares: 2_000n * (p1 ? E6 : E18),
    totalCollateral: 0n,
    borrowLimit: 1n << 200n,
    availableLiquidity: 8_000n * (p1 ? E6 : E18),
    utilization: 20,
    // R: collateral per asset × 1e18 (ETH = $2,000).
    exchangeRate: (p1 ? 5n * 10n ** 26n : 2n * 10n ** 9n) as bigint | undefined,
    oracleBadData: false as boolean | undefined,
    loaded: true,
    ratePerSec: 1n,
    feeToProtocolRate: 0n,
    interestPaused: false,
    lendApr: new Decimal(p1 ? RATES.p1Lend.apr : RATES.p2Lend.apr),
    borrowApr: new Decimal(p1 ? RATES.p1Borrow.apr : RATES.p2Borrow.apr),
  };
};

const p1Position = () => ({
  ...pairInfo("P1"),
  suppliedShares: 1_000n * E6,
  borrowedShares: 500n * E6,
  collateralAmount: E18,
  suppliedAssets: 1_000n * E6 as bigint | undefined,
  borrowedAssets: 500n * E6 as bigint | undefined,
});
const p2CollateralOnly = () => ({
  ...pairInfo("P2"),
  suppliedShares: 0n,
  borrowedShares: 0n,
  collateralAmount: 3_000n * E6,
  suppliedAssets: 0n as bigint | undefined,
  borrowedAssets: 0n as bigint | undefined,
});

function seed() {
  fake.data.core = {
    positions: [
      { asset: WETH, symbol: "WETH", decimals: 18, supplied: 0n, borrowed: E18, collateral: 0n, collateralEnabled: false },
      { asset: USDC, symbol: "USDC", decimals: 6, supplied: 10_000n * E6, borrowed: 0n, collateral: 10_000n * E6, collateralEnabled: true },
    ],
    accountData: {
      totalCollateralBase: 10_000n * E8,
      totalDebtBase: 2_000n * E8,
      availableBorrowsBase: 5_500n * E8,
      currentLiquidationThreshold: 7_800n,
      ltv: 7_500n,
      healthFactor: 39n * 10n ** 17n,
    } as Record<string, bigint> | undefined,
    eMode: 0n as bigint | undefined,
    stamp: stamp(1_000n),
    isLoading: false,
    isError: false,
    isConnected: true,
    refetch: async () => ({}),
  };
  fake.data.iso = {
    positions: [p1Position(), p2CollateralOnly()],
    incomplete: false,
    unknownPairs: [] as string[],
    knownPairs: new Set([PAIR_USDC_WETH.toLowerCase(), PAIR_WETH_USDC.toLowerCase()]),
    stamp: stamp(1_010n),
    conversionStamp: stamp(1_005n),
    pairsStamp: stamp(995n),
    isLoading: false,
  };
  fake.data.markets = [
    market("WETH", RATES.wethSupply.apr, RATES.wethBorrow.apr),
    market("USDC", RATES.usdcSupply.apr, RATES.usdcBorrow.apr),
  ];
  fake.data.pairs = [pairInfo("P1"), pairInfo("P2")];
}

type Iso = { positions: ReturnType<typeof p1Position>[]; unknownPairs: string[]; incomplete: boolean };
type Core = { eMode: bigint | undefined; accountData: Record<string, bigint> | undefined };

beforeEach(() => {
  resetFake();
  seed();
  vi.mocked(accountTotals).mockClear();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const summary = () =>
  Object.fromEntries(["net-worth", "deposits", "debt", "net-apy"].map((id) => [id, screen.getByTestId(`summary-${id}`).textContent]));
const rows = () => screen.getAllByTestId("position-row");
const rowOf = (kind: string, text: RegExp) => rows().find((r) => r.getAttribute("data-kind") === kind && text.test(r.textContent ?? ""))!;
const openModal = () => {
  const m = screen.getByTestId("modal");
  return { name: m.getAttribute("data-name"), props: JSON.parse(m.getAttribute("data-props")!) as Record<string, unknown> };
};
const closeModal = () => fireEvent.click(screen.getByRole("button", { name: "close-modal" }));

// ---------------------------------------------------------------------------------------------

describe("totals: the dashboard and the portfolio both show accountTotals(), equal", () => {
  it("each page renders exactly what accountTotals() returned, and the two pages agree", () => {
    render(<Dashboard />);
    expect(vi.mocked(accountTotals)).toHaveBeenCalled();
    const t = vi.mocked(accountTotals).mock.results.at(-1)!.value as ReturnType<typeof accountTotals>;
    // 10,000 + 1,000 lent + 2,000 (1 WETH) + 3,000 posted − 2,000 (1 WETH) − 500
    expect(t.netWorth).toBe(13_500n * E8);
    const dashboard = summary();
    expect(dashboard).toEqual({
      "net-worth": formatUsd8(t.netWorth),
      deposits: formatUsd8(t.deposits),
      debt: formatUsd8(t.debt),
      "net-apy": formatApy(t.netApy),
    });
    expect(dashboard["net-worth"]).toBe("$13,500.00");
    expect(dashboard.deposits).toBe("$16,000.00");
    expect(dashboard.debt).toBe("$2,500.00");
    // (10,000 × APY 5% + 1,000 × APY 3% − 2,000 × APY 4% − 500 × APY 6%) / 13,500 = 3.1898…%
    expect(dashboard["net-apy"]).toBe("3.19%");
    // The old core-only "Earning interest" subtitle is gone; deposits include isolated collateral.
    expect(screen.queryByText("Earning interest")).toBeNull();
    expect(screen.getByText("Core + isolated deposits and collateral")).toBeTruthy();
    // The valuation stamp is the oldest read the totals combine (prices, block 990).
    expect(screen.getByText(/Valuation: as of block 990/)).toBeTruthy();
    cleanup();

    vi.mocked(accountTotals).mockClear();
    render(<PortfolioPage />);
    expect(vi.mocked(accountTotals)).toHaveBeenCalled();
    expect(summary()).toEqual(dashboard);
  });

  it("an incomplete isolated read makes the totals unavailable on both pages, never a partial sum", () => {
    update((f) => {
      const i = f.data.iso as Iso;
      i.positions = [p1Position()];
      i.unknownPairs = [PAIR_WETH_USDC.toLowerCase()];
      i.incomplete = true;
    });
    render(<Dashboard />);
    expect(summary()["net-worth"]).toBe("—");
    expect(screen.getByTestId("totals-incomplete")).toBeTruthy();
    cleanup();
    render(<PortfolioPage />);
    expect(summary()["net-worth"]).toBe("—");
  });
});

describe('"Your positions": the row model with working actions', () => {
  it("shows core supply, core borrow, isolated lend and isolated borrow/collateral rows, incl. collateral-only", () => {
    render(<Dashboard />);
    expect(rows().map((r) => r.getAttribute("data-kind"))).toEqual([
      "coreSupply",
      "coreBorrow",
      "isolatedLend",
      "isolatedBorrow",
      "isolatedBorrow",
    ]);
    const supply = rowOf("coreSupply", /USDC/);
    expect(supply.textContent).toMatch(/10,000 USDC/);
    expect(supply.textContent).toMatch(/\$10,000\.00/);
    expect(supply.textContent).toMatch(/Collateral: on/);
    expect(rowOf("coreBorrow", /WETH/).textContent).toMatch(/HF 3\.90 · Safe/);
    const lend = rowOf("isolatedLend", /USDC\/WETH/);
    expect(lend.textContent).toMatch(/1,000 USDC.*\$1,000\.00/);
    const borrow = rowOf("isolatedBorrow", /USDC\/WETH/);
    expect(within(borrow).getByTestId("iso-debt-amount").textContent).toBe("Debt: 500 USDC");
    expect(within(borrow).getByTestId("iso-collateral-amount").textContent).toBe("Collateral: 1 WETH");
    expect(borrow.textContent).toMatch(/\$500\.00/);
    expect(borrow.textContent).toMatch(/\$2,000\.00/);
    expect(borrow.textContent).toMatch(/LTV 25\.00% \/ 75\.00% · Safe/);
    expect(borrow.textContent).toMatch(/Liq\.: ETH below 666\.66 USDC/);
    const collateralOnly = rowOf("isolatedBorrow", /WETH\/USDC/);
    expect(collateralOnly.textContent).toMatch(/collateral only/);
    expect(collateralOnly.textContent).toMatch(/Collateral: 3,000 USDC/);
    expect(collateralOnly.textContent).toMatch(/\$3,000\.00/);
    expect(within(collateralOnly).queryByRole("button", { name: "Repay" })).toBeNull();
  });

  it("each row action opens the existing modal with its current props", () => {
    render(<Dashboard />);
    const click = (row: HTMLElement, name: string) => fireEvent.click(within(row).getByRole("button", { name }));
    const cases: [HTMLElement, string, string, Record<string, unknown>][] = [
      [rowOf("coreSupply", /USDC/), "Supply", "SupplyModal", { asset: USDC, symbol: "USDC", decimals: 6 }],
      [rowOf("coreSupply", /USDC/), "Withdraw", "WithdrawModal", { asset: USDC, symbol: "USDC", decimals: 6 }],
      [rowOf("coreSupply", /USDC/), "Disable collateral", "EnableCollateralModal", { asset: USDC, symbol: "USDC", currentlyEnabled: true }],
      [rowOf("coreBorrow", /WETH/), "Borrow", "BorrowModal", { asset: WETH, symbol: "WETH", decimals: 18 }],
      [rowOf("coreBorrow", /WETH/), "Repay", "RepayModal", { asset: WETH, symbol: "WETH", decimals: 18 }],
      [rowOf("isolatedLend", /USDC\/WETH/), "Lend", "IsolatedLendModal", { pair: PAIR_USDC_WETH }],
      [rowOf("isolatedLend", /USDC\/WETH/), "Withdraw", "IsolatedWithdrawModal", { pair: PAIR_USDC_WETH }],
      [rowOf("isolatedBorrow", /USDC\/WETH/), "Borrow", "IsolatedBorrowModal", { pair: PAIR_USDC_WETH }],
      [rowOf("isolatedBorrow", /USDC\/WETH/), "Repay", "IsolatedRepayModal", { pair: PAIR_USDC_WETH }],
      [rowOf("isolatedBorrow", /USDC\/WETH/), "Add collateral", "IsolatedAddCollateralModal", { pair: PAIR_USDC_WETH }],
      [rowOf("isolatedBorrow", /WETH\/USDC/), "Remove collateral", "IsolatedRemoveCollateralModal", { pair: PAIR_WETH_USDC }],
    ];
    for (const [row, button, modal, props] of cases) {
      click(row, button);
      expect(openModal(), `${button} → ${modal}`).toEqual({ name: modal, props });
      closeModal();
      expect(screen.queryByTestId("modal")).toBeNull();
    }
  });

  it("a failed read is a row that says so, never a hidden position", () => {
    update((f) => {
      const i = f.data.iso as Iso;
      i.positions = [p1Position()];
      i.unknownPairs = [PAIR_WETH_USDC.toLowerCase()];
      i.incomplete = true;
    });
    render(<Dashboard />);
    const unknown = rowOf("unavailable", /WETH\/USDC/);
    expect(unknown.textContent).toMatch(/Position unavailable/);
  });
});

describe("risk card: riskiest-position priority and one overall status", () => {
  const status = () => screen.getByTestId("overall-status").textContent;
  const isolatedCard = () => screen.getByTestId("risk-isolated");

  it("all known and healthy: Safe, with the core HF and its liquidation price", () => {
    render(<Dashboard />);
    expect(status()).toBe("Overall: Safe");
    const coreCard = screen.getByTestId("risk-core");
    expect(coreCard.textContent).toMatch(/3\.90/);
    // 10,000 USDC at 78% LT against 1 WETH: liquidatable above $7,800.
    expect(coreCard.textContent).toMatch(/ETH above \$7,800\.00/);
  });

  it("picks the highest ltv/maxLTV (cross-multiplied), not the highest LTV", () => {
    update((f) => {
      const i = f.data.iso as Iso;
      // P1: 60% at a 90% max (0.67). P2: 50% at a 55% max (0.91) → riskier, Danger.
      i.positions = [
        { ...p1Position(), borrowedAssets: 1_200n * E6, maxLTV: 90_000n },
        { ...p2CollateralOnly(), borrowedShares: 1n, borrowedAssets: (3n * E18) / 4n, maxLTV: 55_000n },
      ];
    });
    render(<Dashboard />);
    expect(isolatedCard().textContent).toMatch(/WETH\/USDC/);
    expect(isolatedCard().textContent).toMatch(/50\.00%/);
    expect(status()).toBe("Overall: Danger");
  });

  it("a liquidatable position comes first, even with an unknown pair", () => {
    update((f) => {
      const i = f.data.iso as Iso;
      i.positions = [{ ...p1Position(), collateralAmount: 0n }];
      i.unknownPairs = [PAIR_WETH_USDC.toLowerCase()];
      i.incomplete = true;
    });
    render(<Dashboard />);
    expect(isolatedCard().textContent).toMatch(/USDC\/WETH/);
    expect(isolatedCard().textContent).toMatch(/Liquidatable now/);
    expect(status()).toBe("Overall: Liquidatable");
  });

  it("not Safe while a pair is in unknownPairs", () => {
    update((f) => {
      const i = f.data.iso as Iso;
      i.positions = [p1Position()];
      i.unknownPairs = [PAIR_WETH_USDC.toLowerCase()];
      i.incomplete = true;
    });
    render(<Dashboard />);
    expect(screen.getByTestId("risk-isolated-unknown").textContent).toMatch(/WETH\/USDC: position unavailable/);
    expect(status()).toBe("Overall: Unavailable");
  });

  it("not Safe while core data is missing (the HF read, or the eMode read the per-reserve maths needs)", () => {
    update((f) => {
      (f.data.core as Core).accountData = undefined;
    });
    render(<Dashboard />);
    expect(status()).toBe("Overall: Unavailable");
    cleanup();
    seed();
    update((f) => {
      (f.data.core as Core).eMode = undefined;
    });
    render(<Dashboard />);
    expect(screen.getByTestId("risk-core").textContent).toMatch(/Liquidation price: Unavailable/);
    expect(status()).toBe("Overall: Unavailable");
  });
});

describe("portfolio: no 'Pool net', Lighter behind a remembered toggle", () => {
  it("the 'Pool net' label is gone", () => {
    render(<PortfolioPage />);
    expect(screen.queryByText(/Pool net/i)).toBeNull();
    expect(screen.getByTestId("summary-net-worth").textContent).toBe("$13,500.00");
  });

  it("collapsed by default; Show Lighter mounts the unchanged embed with the accountTotals legs; the choice is remembered", async () => {
    render(<PortfolioPage />);
    expect(screen.queryByTestId("lighter-embed")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show Lighter" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => fireEvent.click(toggle));
    expect((await screen.findByTestId("lighter-embed")).textContent).toBe("Lumina pool supply 10000");
    expect(window.localStorage.getItem(SHOW_LIGHTER_KEY)).toBe("1");
    cleanup();

    render(<PortfolioPage />);
    expect(await screen.findByTestId("lighter-embed")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide Lighter" })));
    expect(screen.queryByTestId("lighter-embed")).toBeNull();
    expect(window.localStorage.getItem(SHOW_LIGHTER_KEY)).toBe("0");
  });

  it("storage that throws (private mode, blocked site data) → collapsed, and the toggle still works", async () => {
    const storage = stubStorage({ getThrows: true, setThrows: true });
    render(<PortfolioPage />);
    expect(screen.queryByTestId("lighter-embed")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show Lighter" })));
    expect(await screen.findByTestId("lighter-embed")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide Lighter" })));
    expect(screen.queryByTestId("lighter-embed")).toBeNull();
    expect(storage.calls).toEqual({ get: storage.calls.get, set: 2 });
    expect(storage.calls.get).toBeGreaterThan(0);
    await clearSessionChoice();
  });

  it("storage readable but not writable (QuotaExceededError on setItem only) → the toggle still opens and closes (Gemini r1 #2)", async () => {
    const storage = stubStorage({ setThrows: true, initial: { [SHOW_LIGHTER_KEY]: "0" } });
    render(<PortfolioPage />);
    expect(screen.queryByTestId("lighter-embed")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show Lighter" })));
    expect(await screen.findByTestId("lighter-embed")).toBeTruthy();
    // The stored value is still "0": the session choice wins while storage cannot be written.
    expect(storage.map.get(SHOW_LIGHTER_KEY)).toBe("0");
    expect(storage.calls.set).toBe(1);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Hide Lighter" })));
    expect(screen.queryByTestId("lighter-embed")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show Lighter" })));
    expect(await screen.findByTestId("lighter-embed")).toBeTruthy();
    await clearSessionChoice();
  });
});

/**
 * Replace window.localStorage with a Map-backed fake whose reads and/or writes throw. (happy-dom's
 * localStorage is a Proxy with its own bound methods, so a Storage.prototype spy would not reach it.)
 */
function stubStorage(opts: { getThrows?: boolean; setThrows?: boolean; initial?: Record<string, string> }) {
  const map = new Map(Object.entries(opts.initial ?? {}));
  const calls = { get: 0, set: 0 };
  const fake = {
    getItem: (k: string) => {
      calls.get += 1;
      if (opts.getThrows) throw new DOMException("denied", "SecurityError");
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      calls.set += 1;
      if (opts.setThrows) throw new DOMException("quota", "QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
  vi.spyOn(window, "localStorage", "get").mockReturnValue(fake as unknown as Storage);
  return { map, calls };
}

/** Writable storage again: one successful write clears the toggle's session-only choice. */
async function clearSessionChoice() {
  vi.restoreAllMocks();
  cleanup();
  render(<PortfolioPage />);
  const button = screen.getByRole("button", { name: /Lighter/ });
  await act(async () => fireEvent.click(button));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /Lighter/ })));
  cleanup();
}

describe("APY cells use aprToApy on every page (never the raw APR)", () => {
  const expectApys = (apys: string[]) => {
    for (const apy of apys) expect(screen.getAllByText(apy).length, apy).toBeGreaterThan(0);
    for (const apr of APR_TEXTS) expect(screen.queryAllByText(apr), apr).toHaveLength(0);
  };

  it("dashboard: market tables and position rows", () => {
    render(<Dashboard />);
    expectApys([RATES.wethSupply.apy, RATES.wethBorrow.apy, RATES.usdcSupply.apy, RATES.usdcBorrow.apy, RATES.p1Lend.apy, RATES.p1Borrow.apy]);
    expect(rowOf("coreSupply", /USDC/).textContent).toMatch(RATES.usdcSupply.apy);
    expect(rowOf("isolatedBorrow", /USDC\/WETH/).textContent).toMatch(RATES.p1Borrow.apy);
  });

  it("portfolio: supply and borrow tables", () => {
    render(<PortfolioPage />);
    expectApys([RATES.usdcSupply.apy, RATES.wethBorrow.apy]);
  });

  it("/markets and /markets/[asset]", () => {
    render(<MarketsPage />);
    expectApys([RATES.wethSupply.apy, RATES.wethBorrow.apy, RATES.usdcSupply.apy, RATES.usdcBorrow.apy]);
    cleanup();
    params.asset = "usdc";
    render(<MarketDetailPage />);
    expectApys([RATES.usdcSupply.apy, RATES.usdcBorrow.apy]);
  });

  it("a paused pair (interest paused → APRs 0) reads 0.00%, not — (spec §3.1, r2 #1)", () => {
    const paused = { lendApr: new Decimal(0), borrowApr: new Decimal(0), interestPaused: true };
    update((f) => {
      f.data.pairs = [pairInfo("P1"), { ...pairInfo("P2"), ...paused }];
      (f.data.iso as Iso).positions = [{ ...p1Position(), ...paused }, p2CollateralOnly()];
    });
    render(<IsolatedPage />);
    expect(screen.getAllByTestId("pair-lend-apy").map((c) => c.textContent)).toEqual([RATES.p1Lend.apy, "0.00%"]);
    expect(screen.getAllByTestId("pair-borrow-apy").map((c) => c.textContent)).toEqual([RATES.p1Borrow.apy, "0.00%"]);
    cleanup();
    render(<Dashboard />);
    expect(rowOf("isolatedLend", /USDC\/WETH/).textContent).toMatch(/0\.00%/);
    expect(rowOf("isolatedBorrow", /USDC\/WETH/).textContent).toMatch(/0\.00%/);
    expect(rowOf("isolatedBorrow", /USDC\/WETH/).textContent).not.toMatch(/—/);
    // A paused pair still has a net APY (its 0% is known), not "—".
    expect(screen.getByTestId("summary-net-apy").textContent).not.toBe("—");
  });

  it("isolated page: Lend APY and Borrow APY per pair", () => {
    render(<IsolatedPage />);
    expect(screen.getAllByTestId("pair-lend-apy").map((c) => c.textContent)).toEqual([RATES.p1Lend.apy, RATES.p2Lend.apy]);
    expect(screen.getAllByTestId("pair-borrow-apy").map((c) => c.textContent)).toEqual([RATES.p1Borrow.apy, RATES.p2Borrow.apy]);
    for (const apr of APR_TEXTS) expect(screen.queryAllByText(apr), apr).toHaveLength(0);
  });
});

describe("isolated page: columns and USD (spec §3.3, r1 #17)", () => {
  it("All Pairs: Lend APY and Borrow APY added, 'Rate' renamed 'Price', the redundant Asset and Collateral columns dropped", () => {
    render(<IsolatedPage />);
    const table = screen.getAllByTestId("pair-lend-apy")[0].closest("table")!;
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Pair", "Total Supplied", "Total Borrowed", "Util", "Lend APY", "Borrow APY", "Max LTV", "Price", "Action"]);
    expect(within(table).getAllByRole("row")[1].textContent).toMatch(/1 USDC = 0\.0005 WETH/);
  });

  it("the Your Positions stamp includes the oracle price block once rows show USD (Gemini r1 #3, FE-07)", () => {
    // snapshots 1010, conversions 1005, pairs 995, prices 990 → the oldest is the price read.
    render(<IsolatedPage />);
    expect(screen.getByText(/as of block 990/)).toBeTruthy();
  });

  it("position rows carry USD values (oracle prices; collateral through the pair rate)", () => {
    render(<IsolatedPage />);
    expect(screen.getAllByTestId("lent-usd").map((c) => c.textContent)).toEqual(["$1,000.00"]);
    expect(screen.getAllByTestId("borrowed-usd").map((c) => c.textContent)).toEqual(["$500.00"]);
    expect(screen.getAllByTestId("collateral-usd").map((c) => c.textContent)).toEqual(["$2,000.00", "$3,000.00"]);
    expect(screen.getByText("25.00% / 75.00%")).toBeTruthy();
  });
});

describe("layout: the content column can shrink below its content (spec §3.3, r1 #17)", () => {
  it("has min-w-0, so a wide table scrolls inside its card instead of widening the page", () => {
    render(
      <AppLayout>
        <div />
      </AppLayout>,
    );
    const column = screen.getByRole("main").parentElement!;
    expect(column.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex-1", "min-w-0"]));
  });
});

describe("initial isolated load: skeletons, not a flash of 'unavailable' (Gemini r1 #4)", () => {
  it("while the isolated reads load: no unavailable rows, the risk pick is a skeleton, the status reads Loading", () => {
    update((f) => {
      const i = f.data.iso as Iso & { isLoading: boolean };
      i.isLoading = true;
      i.positions = [];
      i.unknownPairs = [PAIR_USDC_WETH.toLowerCase(), PAIR_WETH_USDC.toLowerCase()];
      i.incomplete = true;
    });
    render(<Dashboard />);
    expect(rows().map((r) => r.getAttribute("data-kind"))).toEqual(["coreSupply", "coreBorrow"]);
    expect(screen.queryByText(/Position unavailable/)).toBeNull();
    expect(screen.getByTestId("risk-isolated-loading")).toBeTruthy();
    expect(screen.queryByTestId("risk-isolated-unknown")).toBeNull();
    expect(screen.getByTestId("overall-status").textContent).toBe("Overall: Loading…");
  });
});

describe("layout at 1024 px (coordinator #6): no clipped actions, no overlapping text", () => {
  it("each position's actions sit on their own full-width line; there is no Actions column", () => {
    render(<Dashboard />);
    const table = rows()[0].closest("table")!;
    expect(within(table.querySelector("thead")!).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Position",
      "Amount",
      "Value",
      "APY",
      "Risk",
    ]);
    for (const row of rows()) {
      const [data, actions] = within(row).getAllByRole("row");
      expect(within(data).queryAllByRole("button")).toHaveLength(0);
      const line = actions.querySelector("td")!;
      expect(line.getAttribute("colspan")).toBe("5");
      expect(within(line).getAllByRole("button").length).toBeGreaterThan(0);
    }
  });

  it("token icons sit in fixed-size boxes, so a table column never sizes them as 0 px", () => {
    render(<Dashboard />);
    const icons = rows().flatMap((r) => [...r.querySelectorAll("img")]);
    expect(icons.length).toBeGreaterThan(0);
    for (const img of icons) expect(img.parentElement!.style.width).toBe(`${img.getAttribute("width")}px`);
    cleanup();
    render(<IsolatedPage />);
    const pairIcons = [...document.querySelectorAll("table img")];
    expect(pairIcons.length).toBeGreaterThan(0);
    for (const img of pairIcons) expect(img.parentElement!.style.width).toBe(`${img.getAttribute("width")}px`);
  });

  it("isolated Your Positions: actions on their own line under each position", () => {
    render(<IsolatedPage />);
    const buttons = screen.getAllByRole("button").filter((b) => /Withdraw|Repay|Add collateral|Remove/.test(b.textContent ?? ""));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.closest("td")!.getAttribute("colspan")).toBe("5");
  });
});

describe("MarketTable: valid HTML, a real link and a clickable row (coordinator #8, Gemini r2 #2)", () => {
  const marketRow = (symbol: string) => screen.getAllByTestId("market-row").find((r) => r.textContent?.includes(symbol))!;

  beforeEach(() => {
    router.push = vi.fn();
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("no <a> around a <tr> and no stretched overlay: a normal link in the asset cell, with a focus ring", () => {
    const { container } = render(<MarketsPage />);
    expect(container.querySelectorAll("tbody > a, a > tr")).toHaveLength(0);
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/markets/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/markets/weth", "/markets/usdc"]);
    for (const a of links) {
      expect(a.closest("td")).not.toBeNull();
      expect(a.className).not.toMatch(/after:/);
      expect(a.closest("tr")!.className.split(/\s+/)).not.toContain("relative");
      expect(a.className).toMatch(/focus-visible:ring-2/);
    }
  });

  it("clicking a non-link cell opens that row's market through the router", () => {
    render(<MarketsPage />);
    fireEvent.click(within(marketRow("USDC")).getByText(RATES.usdcBorrow.apy));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/markets/usdc");
    fireEvent.click(within(marketRow("WETH")).getByText(RATES.wethSupply.apy));
    expect(router.push).toHaveBeenLastCalledWith("/markets/weth");
  });

  it("clicking the link is the link's own navigation (the row handler stays out); a text selection is not a click", () => {
    render(<MarketsPage />);
    fireEvent.click(within(marketRow("WETH")).getByRole("link"));
    expect(window.location.pathname).toBe("/markets/weth");
    expect(router.push).not.toHaveBeenCalled();
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "5.13" } as unknown as Selection);
    fireEvent.click(within(marketRow("USDC")).getByText(RATES.usdcSupply.apy));
    expect(router.push).not.toHaveBeenCalled();
  });
});

/** Whether `el` is displayed below xl (no "hidden" on it or an ancestor) and at xl (no "xl:hidden"). */
const shownBelowXl = (el: Element) => !el.closest(".hidden");
const shownAtXl = (el: Element) => {
  for (let e: Element | null = el; e; e = e.parentElement) if (e.classList.contains("xl:hidden")) return false;
  return true;
};

describe("isolated All Pairs: every value visible at every width (Gemini r2 #1)", () => {
  it("Price and Util: their own columns from xl, sublines below xl; each value shows at both widths", () => {
    render(<IsolatedPage />);
    const prices = ["1 USDC = 0.0005 WETH", "1 WETH = 2,000 USDC"];
    for (const [i, price] of prices.entries()) {
      const column = screen.getAllByTestId("pair-price")[i];
      const inline = screen.getAllByTestId("pair-price-inline")[i];
      expect(column.textContent).toBe(price);
      expect(inline.textContent).toBe(`Price: ${price}`);
      expect([shownBelowXl(column), shownAtXl(column)]).toEqual([false, true]);
      expect([shownBelowXl(inline), shownAtXl(inline)]).toEqual([true, false]);
    }
    for (const [i, cell] of screen.getAllByTestId("pair-util").entries()) {
      const inline = screen.getAllByTestId("pair-util-inline")[i];
      expect(cell.textContent).toBe("20.0%");
      expect(inline.textContent).toBe("20.0% util");
      expect([shownBelowXl(cell), shownAtXl(cell)]).toEqual([false, true]);
      expect([shownBelowXl(inline), shownAtXl(inline)]).toEqual([true, false]);
    }
  });

  it("the empty and loading rows span exactly the columns visible at each width (7 below xl, 9 from xl)", () => {
    update((f) => {
      f.data.pairs = [];
    });
    render(<IsolatedPage />);
    // One cell per breakpoint (only one is displayed at a time).
    const messages = screen.getAllByText("No isolated pairs in the deployment manifest");
    expect(messages).toHaveLength(2);
    expect(messages.filter(shownBelowXl)).toHaveLength(1);
    expect(messages.filter(shownAtXl)).toHaveLength(1);
    const table = messages[0].closest("table")!;
    const headers = [...table.querySelectorAll("thead th")];
    const visible = (pred: (e: Element) => boolean) => headers.filter(pred).length;
    expect([visible(shownBelowXl), visible(shownAtXl)]).toEqual([7, 9]);
    const cells = [...table.querySelectorAll("tbody td")];
    expect(cells.filter(shownBelowXl).map((c) => c.getAttribute("colspan"))).toEqual(["7"]);
    expect(cells.filter(shownAtXl).map((c) => c.getAttribute("colspan"))).toEqual(["9"]);
  });
});

describe("cards keep long values inside (Gemini r2 #3)", () => {
  it("each wide table sits in an inner horizontal scroller inside its card", () => {
    render(<Dashboard />);
    const positions = rows()[0].closest("table")!;
    expect(positions.parentElement!.className).toContain("overflow-x-auto");
    expect(positions.parentElement!.parentElement!.className).toContain("technical-border");
    cleanup();
    render(<IsolatedPage />);
    const tables = [...document.querySelectorAll("table")];
    expect(tables).toHaveLength(2);
    for (const t of tables) {
      expect(t.parentElement!.className).toContain("overflow-x-auto");
      expect(t.parentElement!.parentElement!.className).toContain("technical-border");
    }
  });

  it("the stale-oracle subline under the LTV can wrap", () => {
    update((f) => {
      (f.data.iso as Iso).positions = [{ ...p1Position(), oracleBadData: true }, p2CollateralOnly()];
    });
    render(<IsolatedPage />);
    const subline = screen.getByText(/· price data stale/);
    expect(subline.className).toContain("whitespace-normal");
  });
});
