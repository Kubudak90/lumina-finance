// @vitest-environment happy-dom
/**
 * ui-usability-v1 U1: the new reads ride the EXISTING multicalls (Pool.getUserEMode in the user
 * position multicall; previewAddInterest + isInterestPaused in the pairs multicall), the old
 * fields keep their values, and HealthFactorBar keeps its old props and gains an LTV variant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { fake, resetFake, type CallResult, type ContractCall } from "../support/fakeChain";
import { DUAL_USDC_WETH, PAIR_USDC_WETH, PAIR_WETH_USDC, POOL } from "../support/deployment";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));

import { useUserPosition } from "@/hooks/useUserPosition";
import { useIsolatedPairs } from "@/hooks/useIsolatedPairs";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { aprToApy } from "@/lib/risk";

const ok = (result: unknown): CallResult => ({ status: "success", result });
const fail: CallResult = { status: "failure", error: new Error("reverted") };
const RATE_PER_SEC = 1_585_489_599n; // ≈ 5% APR
const MAX_HF = (1n << 256n) - 1n;

interface Script {
  eMode?: bigint | "fail";
  paused?: boolean | "fail";
  preview?: "fail";
}

function chain(script: Script = {}) {
  return (calls: readonly ContractCall[]) =>
    calls.map((c) => {
      switch (c.functionName) {
        case "getBlockNumber":
          return ok(1_000n);
        case "getCurrentBlockTimestamp":
          return ok(1_700_000_000n);
        case "getUserAccountData":
          return ok([1n, 2n, 3n, 7_800n, 7_500n, MAX_HF]);
        case "balanceOf":
          return ok(5n);
        case "getUserReserveData":
          return ok([5n, 0n, 0n, 0n, 0n, 0n, 0n, 0, true]);
        case "getUserEMode":
          return script.eMode === "fail" ? fail : ok(script.eMode ?? 0n);
        case "maxLTV":
          return ok(75_000n);
        case "getPairAccounting":
          return ok([1_000n, 1_000n, 800n, 800n, 7n]);
        case "borrowLimit":
          return ok(1n << 200n);
        case "getPrices":
          return ok([c.address === DUAL_USDC_WETH, 11n, 12n]);
        case "previewAddInterest":
          // viem decodes uint32 fields as numbers and uint64 as bigints.
          return script.preview === "fail"
            ? fail
            : ok([
                0n,
                0n,
                0n,
                { lastBlock: 9, feeToProtocolRate: 10_000, lastTimestamp: 5n, ratePerSec: RATE_PER_SEC, fullUtilizationRate: 1n },
                { amount: 1_000n, shares: 1_000n },
                { amount: 800n, shares: 800n },
              ]);
        case "isInterestPaused":
          return script.paused === "fail" ? fail : ok(script.paused ?? false);
        default:
          return fail;
      }
    });
}

beforeEach(() => {
  resetFake();
  fake.multicall = chain();
});
afterEach(() => cleanup());

describe("useUserPosition: Pool.getUserEMode in the existing multicall", () => {
  it("is read in the same multicall as getUserAccountData; the old outputs are unchanged", () => {
    const { result } = renderHook(() => useUserPosition());
    const call = fake.multicallSpy.at(-1)!.calls;
    expect(call.some((c) => c.functionName === "getUserAccountData")).toBe(true);
    const eMode = call.find((c) => c.functionName === "getUserEMode")!;
    expect(eMode.address).toBe(POOL);
    expect(result.current.eMode).toBe(0n);
    expect(result.current.accountData).toEqual({
      totalCollateralBase: 1n,
      totalDebtBase: 2n,
      availableBorrowsBase: 3n,
      currentLiquidationThreshold: 7_800n,
      ltv: 7_500n,
      healthFactor: MAX_HF,
    });
    for (const p of result.current.positions) expect(p).toMatchObject({ supplied: 5n, borrowed: 5n, collateral: 5n, collateralEnabled: true });
  });

  it("a non-zero category is reported; a failed read is undefined (never 0)", () => {
    fake.multicall = chain({ eMode: 1n });
    expect(renderHook(() => useUserPosition()).result.current.eMode).toBe(1n);
    fake.multicall = chain({ eMode: "fail" });
    expect(renderHook(() => useUserPosition()).result.current.eMode).toBeUndefined();
  });
});

describe("useIsolatedPairs: previewAddInterest and isInterestPaused in the existing multicall", () => {
  it("both ride the pairs multicall; the old fields keep their values", () => {
    const { result } = renderHook(() => useIsolatedPairs());
    const call = fake.multicallSpy.at(-1)!.calls;
    for (const pair of [PAIR_USDC_WETH, PAIR_WETH_USDC]) {
      for (const fn of ["getPairAccounting", "previewAddInterest", "isInterestPaused"]) {
        expect(call.some((c) => c.address === pair && c.functionName === fn), `${pair} ${fn}`).toBe(true);
      }
    }
    const p = result.current.pairs.find((x) => x.pair === PAIR_USDC_WETH)!;
    expect(p).toMatchObject({
      maxLTV: 75_000n,
      totalAssetAmount: 1_000n,
      totalBorrowAmount: 800n,
      totalCollateral: 7n,
      borrowLimit: 1n << 200n,
      exchangeRate: 12n,
      oracleBadData: true,
      loaded: true,
    });
    expect(result.current.pairs.find((x) => x.pair === PAIR_WETH_USDC)!.oracleBadData).toBe(false);
  });

  it("exposes the live rate, the fee, the pause flag and the APRs from the previewed totals", () => {
    const p = renderHook(() => useIsolatedPairs()).result.current.pairs[0];
    expect(p.ratePerSec).toBe(RATE_PER_SEC);
    expect(p.feeToProtocolRate).toBe(10_000n);
    expect(p.interestPaused).toBe(false);
    const borrowApr = p.borrowApr!;
    // ratePerSec × 31,536,000 / 1e18, exact (no float).
    expect(borrowApr.toString()).toBe("0.049999999994064");
    expect(p.lendApr!.equals(borrowApr.mul("0.8").mul("0.9"))).toBe(true);
    expect(aprToApy(borrowApr).gt(borrowApr)).toBe(true);
  });

  it("a paused pair reports 0 APRs; an unreadable pause flag or rate is unavailable", () => {
    fake.multicall = chain({ paused: true });
    const paused = renderHook(() => useIsolatedPairs()).result.current.pairs[0];
    expect(paused.interestPaused).toBe(true);
    expect(paused.borrowApr!.isZero()).toBe(true);
    expect(paused.lendApr!.isZero()).toBe(true);
    fake.multicall = chain({ paused: "fail" });
    expect(renderHook(() => useIsolatedPairs()).result.current.pairs[0].borrowApr).toBeUndefined();
    fake.multicall = chain({ preview: "fail" });
    const noRate = renderHook(() => useIsolatedPairs()).result.current.pairs[0];
    expect(noRate.ratePerSec).toBeUndefined();
    expect(noRate.lendApr).toBeUndefined();
    expect(noRate.maxLTV).toBe(75_000n);
  });
});

describe("HealthFactorBar", () => {
  it("keeps its old props (healthFactor) with thresholds and the 0–3 scale from formatHealth", () => {
    render(<HealthFactorBar healthFactor={(15n * 10n ** 18n) / 10n} />);
    expect(screen.getByText("1.50")).toBeTruthy();
    const meter = screen.getByRole("meter", { name: "Health Factor" });
    expect(meter.getAttribute("aria-valuenow")).toBe("50");
    expect(meter.getAttribute("aria-valuetext")).toBe("1.50, Safe");
    expect(screen.getByText(/Liquidation at < 1.0/)).toBeTruthy();
  });

  it("no debt reads ∞; a liquidatable HF is labelled so", () => {
    render(<HealthFactorBar healthFactor={MAX_HF} />);
    expect(screen.getByText("∞")).toBeTruthy();
    cleanup();
    render(<HealthFactorBar healthFactor={9n * 10n ** 17n} />);
    expect(screen.getByRole("meter").getAttribute("aria-valuetext")).toBe("0.90, Liquidatable");
  });

  it("LTV variant: 0–100% of maxLTV", () => {
    render(<HealthFactorBar variant="ltv" ltv={{ kind: "value", ltv: 67_500n }} maxLTV={75_000n} />);
    expect(screen.getByText("67.50%")).toBeTruthy();
    const meter = screen.getByRole("meter", { name: "LTV" });
    expect(meter.getAttribute("aria-valuenow")).toBe("90");
    expect(meter.getAttribute("aria-valuetext")).toBe("67.50%, Danger");
    expect(screen.getByText(/Liquidation above 75.00% LTV/)).toBeTruthy();
  });
});
