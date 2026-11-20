// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { fake, resetFake, type CallResult, type ContractCall } from "../support/fakeChain";
import { DUAL_USDC_WETH, DUAL_WETH_USDC, PAIR_USDC_WETH, PAIR_WETH_USDC, USDC, WETH, fake as addr } from "../support/deployment";
import { QUERY } from "@/lib/queryPolicy";
import { isolatedLegsUsd } from "@/lib/valuation";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));

import { useUserPosition } from "@/hooks/useUserPosition";
import { useIsolatedPosition, useUserIsolatedPositions } from "@/hooks/useUserIsolatedPositions";
import { useIsolatedPairs } from "@/hooks/useIsolatedPairs";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useOraclePrices } from "@/hooks/useOraclePrices";
import { useGuardStatus } from "@/hooks/useGuardStatus";

const ok = (result: unknown): CallResult => ({ status: "success", result });
const fail: CallResult = { status: "failure", error: new Error("reverted") };
const RATE_USDC_WETH = 5n * 10n ** 26n; // WETH per USDC × 1e18 (ETH $2000)
const RATE_WETH_USDC = 2_000n * 10n ** 6n; // USDC per WETH × 1e18

/** A fake chain that answers each call by contract and function; `failing` names calls that revert. */
function chainAnswering(failing: Set<string> = new Set()) {
  return (calls: readonly ContractCall[]) =>
    calls.map((c) => {
      const key = `${c.address?.toLowerCase()}:${c.functionName}`;
      if (failing.has(c.functionName) || failing.has(key)) return fail;
      switch (c.functionName) {
        case "getBlockNumber":
          return ok(1_000n);
        case "getCurrentBlockTimestamp":
          return ok(1_700_000_000n);
        case "maxLTV":
          return ok(75_000n);
        case "getPairAccounting":
          return ok([10n ** 12n, 10n ** 12n, 10n ** 11n, 10n ** 11n, 0n]);
        case "borrowLimit":
          return ok(1n << 200n);
        case "getPrices":
          return ok(c.address === DUAL_USDC_WETH ? [false, RATE_USDC_WETH, RATE_USDC_WETH] : [false, RATE_WETH_USDC, RATE_WETH_USDC]);
        case "getUserSnapshot":
          return ok(c.address === PAIR_USDC_WETH ? [0n, 100n, 10n ** 18n] : [0n, 0n, 0n]);
        case "toAssetAmount":
          return ok(0n);
        case "toBorrowAmount":
          return ok(100_000_000n);
        case "getReserveData":
          return ok({ currentLiquidityRate: 0n, currentVariableBorrowRate: 0n, accruedToTreasury: 0n, interestRateStrategyAddress: addr(0x104) });
        case "totalSupply":
          return ok(10n ** 12n);
        case "getVirtualUnderlyingBalance":
          return ok(10n ** 12n);
        case "getReserveCaps":
          return ok([500n, 0n]);
        case "getTotalDebt":
          return ok(490_000_000n);
        case "getReserveConfigurationData":
          return ok([6n, 7500n, 7800n, 10500n, 1000n, true, true, false, true, false]);
        case "getPaused":
          return ok(false);
        case "getAssetPrice":
          return ok(c.args?.[0] === WETH ? 2_000n * 10n ** 8n : 10n ** 8n);
        case "borrowStatus":
          return ok([0, 0]);
        case "getUserAccountData":
          return ok([0n, 0n, 0n, 0n, 0n, (1n << 256n) - 1n]);
        case "balanceOf":
          return ok(0n);
        case "getUserReserveData":
          return ok([0n, 0n, 0n, 0n, 0n, 0n, 0n, 0, false]);
        default:
          return fail;
      }
    });
}

const priceOf = (a: string) => (a.toLowerCase() === WETH.toLowerCase() ? 2_000n * 10n ** 8n : 10n ** 8n);

beforeEach(() => {
  resetFake();
  fake.multicall = chainAnswering();
});
afterEach(() => cleanup());

describe("position polling is on (FE-07, Codex #14)", () => {
  it("core positions, isolated positions, prices and guard poll every 15 s while enabled", () => {
    renderHook(() => {
      useUserPosition();
      useUserIsolatedPositions();
      useOraclePrices();
      useGuardStatus();
    });
    const byFn = (fn: string) =>
      fake.multicallSpy.filter((s) => s.calls.some((c) => c.functionName === fn)).at(-1)?.options as
        | { enabled?: boolean; policy: { refetchInterval: number | false } }
        | undefined;
    for (const fn of ["getUserAccountData", "getUserSnapshot", "toBorrowAmount", "getAssetPrice", "borrowStatus"]) {
      const options = byFn(fn);
      expect(options, fn).toBeDefined();
      expect(options!.policy.refetchInterval, fn).toBe(QUERY.user.refetchInterval);
      expect(options!.policy.refetchInterval, fn).toBe(15_000);
      expect(options!.enabled ?? true, fn).toBe(true);
    }
  });
});

describe("price orientation per pair (Codex #14)", () => {
  it("each pair takes the rate of its own dual oracle, in its own direction", () => {
    const { result } = renderHook(() => useIsolatedPairs());
    const usdcWeth = result.current.pairs.find((p) => p.pair === PAIR_USDC_WETH)!;
    const wethUsdc = result.current.pairs.find((p) => p.pair === PAIR_WETH_USDC)!;
    expect(usdcWeth.dualOracle).toBe(DUAL_USDC_WETH);
    expect(wethUsdc.dualOracle).toBe(DUAL_WETH_USDC);
    expect(usdcWeth.exchangeRate).toBe(RATE_USDC_WETH);
    expect(wethUsdc.exchangeRate).toBe(RATE_WETH_USDC);
    // 1 WETH of collateral in the USDC/WETH pair is worth $2000; 2000 USDC in the WETH/USDC pair too.
    const legs = isolatedLegsUsd(
      [
        { asset: USDC, assetDecimals: 6, suppliedAssets: 0n, borrowedAssets: 0n, collateralAmount: 10n ** 18n, exchangeRate: usdcWeth.exchangeRate },
        { asset: WETH, assetDecimals: 18, suppliedAssets: 0n, borrowedAssets: 0n, collateralAmount: 2_000_000_000n, exchangeRate: wethUsdc.exchangeRate },
      ],
      priceOf,
    );
    expect(legs.collateral).toBe(4000);
  });
});

describe("failed subqueries are unavailable, not zero (Codex #9)", () => {
  it("isolated: shares exist but toBorrowAmount fails → debt and its USD total are unavailable", () => {
    fake.multicall = chainAnswering(new Set(["toBorrowAmount"]));
    const { result } = renderHook(() => useUserIsolatedPositions());
    const pos = result.current.positions.find((p) => p.pair === PAIR_USDC_WETH)!;
    expect(pos.borrowedShares).toBe(100n);
    expect(pos.borrowedAssets).toBeUndefined();
    expect(isolatedLegsUsd(result.current.positions, priceOf).debt).toBeUndefined();
  });

  it("isolated: with the conversion working the same debt is valued ($100)", () => {
    const { result } = renderHook(() => useUserIsolatedPositions());
    expect(isolatedLegsUsd(result.current.positions, priceOf).debt).toBe(100);
    expect(result.current.conversionStamp).toEqual({ number: 1_000n, timestamp: 1_700_000_000n });
  });

  it("isolated: a failed snapshot marks the list incomplete and the totals unavailable", () => {
    fake.multicall = chainAnswering(new Set([`${PAIR_WETH_USDC.toLowerCase()}:getUserSnapshot`]));
    const { result } = renderHook(() => useUserIsolatedPositions());
    expect(result.current.incomplete).toBe(true);
    expect(isolatedLegsUsd(result.current.positions, priceOf, result.current.incomplete).debt).toBeUndefined();
  });

  it("isolated: the WHOLE snapshot multicall failing or loading is incomplete, never [] with incomplete=false (Gemini r2 M4)", () => {
    const base = chainAnswering();
    // The snapshot multicall has no result at all (failed or still loading).
    fake.multicall = (calls) => (calls.some((c) => c.functionName === "getUserSnapshot") ? undefined : base(calls));
    const { result } = renderHook(() => useUserIsolatedPositions());
    expect(result.current.positions).toEqual([]);
    expect(result.current.incomplete).toBe(true);
    expect(result.current.unknownPairs).toEqual([PAIR_USDC_WETH.toLowerCase(), PAIR_WETH_USDC.toLowerCase()]);
    expect(result.current.knownPairs.size).toBe(0);
    // The portfolio passes `incomplete`: the isolated legs are unavailable, not $0.
    expect(isolatedLegsUsd(result.current.positions, priceOf, result.current.incomplete).debt).toBeUndefined();
  });

  it("isolated: per-pair position state is 'unknown' without a snapshot and 'known' with one", () => {
    const base = chainAnswering();
    fake.multicall = (calls) => (calls.some((c) => c.functionName === "getUserSnapshot") ? undefined : base(calls));
    const unknown = renderHook(() => useIsolatedPosition(PAIR_USDC_WETH));
    expect(unknown.result.current.status).toBe("unknown");
    unknown.unmount();
    fake.multicall = chainAnswering();
    const known = renderHook(() => useIsolatedPosition(PAIR_WETH_USDC));
    expect(known.result.current).toEqual({ status: "known", position: undefined }); // loaded: no position
  });

  it("core: getTotalDebt fails → the market's totalDebt is unavailable, not 0", () => {
    fake.multicall = chainAnswering(new Set(["getTotalDebt"]));
    const { result } = renderHook(() => useAllMarkets());
    for (const m of result.current.markets) {
      expect(m.totalDebt).toBeUndefined();
      expect(m.borrowCap).toBe(500n);
    }
  });
});

vi.mock("@/hooks/useUserPosition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useUserPosition")>();
  return {
    ...actual,
    // Lets the BorrowModal test pin the account data; otherwise the real hook runs.
    useUserPosition: (...args: unknown[]) => {
      if (fake.data.mockAccount) {
        return { positions: [], accountData: fake.data.mockAccount, stamp: undefined, isLoading: false, isError: false, refetch: async () => ({}), isConnected: true };
      }
      return (actual.useUserPosition as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import { BorrowModal } from "@/components/actions/BorrowModal";

describe("BorrowModal shows MAX as unavailable when a limit input failed (Codex #9)", () => {
  it("USDC cap 500, debt 490, capacity $100: MAX 10 normally, 'unavailable' when getTotalDebt fails", () => {
    fake.data.mockAccount = {
      totalCollateralBase: 1_000n * 10n ** 8n,
      totalDebtBase: 0n,
      availableBorrowsBase: 100n * 10n ** 8n,
      currentLiquidationThreshold: 7800n,
      ltv: 7500n,
      healthFactor: (1n << 256n) - 1n,
    };
    const first = render(<BorrowModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    expect(screen.getByTestId("borrow-max").textContent).toBe("10 USDC");
    first.unmount();

    fake.multicall = chainAnswering(new Set(["getTotalDebt"]));
    render(<BorrowModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    expect(screen.getByTestId("borrow-max").textContent).toBe("unavailable");
  });
});
