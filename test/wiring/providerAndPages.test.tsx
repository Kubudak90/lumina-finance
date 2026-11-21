// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fake, resetFake, update, useFakeVersion, type CallResult, type ContractCall } from "../support/fakeChain";
import { POOL, STRATEGY, USDC, WETH, fake as addr } from "../support/deployment";

const spies = vi.hoisted(() => ({
  getDefaultConfig: vi.fn((cfg: unknown) => cfg),
  chainCheckedTransport: vi.fn((...args: [unknown, number]) => (args.length === 2 ? "CHECKED_TRANSPORT" : "")),
  http: vi.fn((url: string) => `HTTP(${url})`),
  params: { asset: "usdc" },
}));

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => ({
  ...(await import("../support/fakeChain")).wagmiModule,
  WagmiProvider: ({ children }: { children: unknown }) => children,
  http: spies.http,
  custom: () => "CUSTOM_TRANSPORT",
}));
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("@/lib/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chains")>()),
  rpcUrlFor: () => "https://rpc.test",
}));
vi.mock("@/lib/rpcGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rpcGuard")>()),
  chainCheckedTransport: spies.chainCheckedTransport,
}));
vi.mock("@rainbow-me/rainbowkit", () => ({
  getDefaultConfig: spies.getDefaultConfig,
  RainbowKitProvider: ({ children }: { children: unknown }) => children,
  darkTheme: () => ({}),
  lightTheme: () => ({}),
}));
vi.mock("@rainbow-me/rainbowkit/wallets", () => ({
  injectedWallet: "injectedWallet",
  rainbowWallet: "rainbowWallet",
  walletConnectWallet: "walletConnectWallet",
}));
vi.mock("@rainbow-me/rainbowkit/styles.css", () => ({}));
vi.mock("next/navigation", () => ({ useParams: () => spies.params, usePathname: () => "/" }));
vi.mock("@/hooks/useAllMarkets", () => ({
  useAllMarkets: () => {
    useFakeVersion();
    return { markets: [], getMarket: () => fake.data.market, isLoading: false };
  },
}));
vi.mock("@/hooks/useOraclePrices", () => ({
  useOraclePrices: () => ({ priceOf: (a: string) => (a.toLowerCase() === WETH.toLowerCase() ? 2_000n * 10n ** 8n : 10n ** 8n) }),
}));
vi.mock("@/hooks/useUserCollateralStatus", () => ({ useUserCollateralStatus: () => ({ isCollateralEnabled: () => false }) }));
vi.mock("@/hooks/useGuardStatus", () => ({ useGuardStatus: () => ({ key: "OK", borrowAllowed: true, message: "", marketId: 0, isLoading: false }) }));
vi.mock("@/hooks/useIsolatedPairs", () => ({ useIsolatedPairs: () => ({ pairs: [], isLoading: false }) }));
vi.mock("@/components/markets/RateCurveChart", () => ({ RateCurveChart: () => <div data-testid="rate-curve" /> }));

const OTHER_STRATEGY = addr(0x999);
const marketInfo = (strategy: `0x${string}` | undefined) => ({
  symbol: "USDC",
  name: "USD Coin",
  asset: USDC,
  decimals: 6,
  aToken: addr(0x401),
  variableDebtToken: addr(0x501),
  totalSupply: 1_000_000_000n,
  totalBorrow: 500_000_000n,
  supplyRate: 0n,
  borrowRate: 0n,
  accruedToTreasury: 0n,
  interestRateStrategy: strategy,
  availableLiquidity: 500_000_000n,
  borrowCap: 0n,
  supplyCap: 0n,
  totalDebt: 500_000_000n,
  config: { ltv: 7500, liquidationThreshold: 7800, liquidationBonus: 10500, reserveFactor: 1000, usageAsCollateralEnabled: true, borrowingEnabled: true, isActive: true, isFrozen: false },
  paused: false,
  loaded: true,
});

beforeEach(() => {
  resetFake();
  spies.getDefaultConfig.mockClear();
  spies.chainCheckedTransport.mockClear();
});
afterEach(() => cleanup());

describe("Web3Provider wiring (Codex #1 / Gemini r2 m5)", () => {
  it("the 19529 transport is the chain-checked one around the configured RPC", async () => {
    vi.resetModules();
    await import("@/providers/Web3Provider");
    expect(spies.chainCheckedTransport).toHaveBeenCalledWith("HTTP(https://rpc.test)", 19529);
    const cfg = spies.getDefaultConfig.mock.calls.at(-1)![0] as { transports: Record<number, unknown>; wallets: { wallets: string[] }[]; chains: { id: number }[] };
    expect(cfg.transports[19529]).toBe("CHECKED_TRANSPORT");
    expect(cfg.chains.map((c) => c.id)).toEqual([19529]);
    expect(cfg.wallets.flatMap((g) => g.wallets)).toEqual(["injectedWallet", "rainbowWallet", "walletConnectWallet"]);
  });
});

import MarketDetailPage from "@/app/(app)/markets/[asset]/page";

describe("market page reads only the manifest's rate strategy (Codex #2 / Gemini r2 m5)", () => {
  const strategyCalls = () =>
    fake.multicallSpy.flatMap((s) => s.calls).filter((c) => c.functionName === "getBaseVariableBorrowRate");

  it("reserve reports another strategy → curve unavailable and the unlisted address is never called", () => {
    fake.data.market = marketInfo(OTHER_STRATEGY);
    fake.multicall = (calls) => calls.map(() => ({ status: "success", result: 10n ** 25n }) as CallResult);
    render(<MarketDetailPage />);
    expect(screen.getByText("Rate curve unavailable")).toBeTruthy();
    expect(strategyCalls().some((c) => c.address === OTHER_STRATEGY)).toBe(false);
    expect(fake.multicallSpy.some((s) => s.calls.some((c) => c.address === OTHER_STRATEGY))).toBe(false);
  });

  it("reserve reports the manifest strategy → the curve reads it", () => {
    fake.data.market = marketInfo(STRATEGY);
    fake.multicall = (calls) => calls.map(() => ({ status: "success", result: 10n ** 25n }) as CallResult);
    render(<MarketDetailPage />);
    expect(strategyCalls().every((c) => c.address === STRATEGY)).toBe(true);
    expect(strategyCalls().length).toBeGreaterThan(0);
    expect(screen.getByTestId("rate-curve")).toBeTruthy();
  });
});

import LiquidationsPage from "@/app/(app)/liquidations/page";

describe("liquidations page uses the v3.2 close factor (Codex #11 / Gemini r2 m5)", () => {
  const BORROWER = "0x00000000000000000000000000000000000B0Bb0";

  function setup(healthFactor: bigint) {
    fake.data.market = marketInfo(STRATEGY); // WETH collateral bonus 10500 via getMarket
    // getUserAccountData(borrower)
    update((f) => f.reads.set(`${POOL.toLowerCase()}:getUserAccountData`, [0n, 0n, 0n, 0n, 0n, healthFactor]));
    // getUserReserveData(asset, borrower): WETH collateral 1 WETH, USDC variable debt 100.
    fake.multicall = (calls: readonly ContractCall[]) =>
      calls.map((c) => {
        const asset = String(c.args?.[0]).toLowerCase();
        if (asset === WETH.toLowerCase()) return { status: "success", result: [10n ** 18n, 0n, 0n, 0n, 0n, 0n, 0n, 0, true] };
        return { status: "success", result: [0n, 0n, 100_000_000n, 0n, 0n, 0n, 0n, 0, false] };
      });
    render(<LiquidationsPage />);
    fireEvent.change(screen.getByPlaceholderText("0x... borrower address"), { target: { value: BORROWER } });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
  }

  it("HF 0.90 → up to 100% of the debt", async () => {
    setup(9n * 10n ** 17n);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Liquidate" })));
    expect(screen.getByText(/Max repayable: 100 USDC \(100% close factor/)).toBeTruthy();
  });

  it("HF 0.96 → 50% of the debt", async () => {
    setup(96n * 10n ** 16n);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Liquidate" })));
    expect(screen.getByText(/Max repayable: 50 USDC \(50% close factor/)).toBeTruthy();
  });
});

import { MarketTable } from "@/components/markets/MarketTable";

describe("MarketTable status (Gemini r2 m3)", () => {
  it("shows Unknown, not Active, when getPaused failed; Paused when it reads true", () => {
    const { unmount } = render(<MarketTable markets={[{ ...marketInfo(STRATEGY), paused: undefined }]} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
    unmount();
    render(<MarketTable markets={[{ ...marketInfo(STRATEGY), paused: true }]} />);
    expect(screen.getByText("Paused")).toBeTruthy();
  });
});
