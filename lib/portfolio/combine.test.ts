import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  accountTotals,
  blockAgeSeconds,
  chainFreshness,
  combinePortfolio,
  lighterFreshness,
  luminaNetUsd,
  type AccountTotalsInput,
} from "./combine";
import { aprToApy, coreApy } from "@/lib/risk";

const lumina = {
  poolSupplyUsd: 1000,
  poolDebtUsd: 200,
  isolatedSupplyUsd: 50,
  isolatedDebtUsd: 10,
  isolatedCollateralUsd: 80,
};

describe("combinePortfolio", () => {
  it("nets Lumina pool + isolated legs", () => {
    expect(luminaNetUsd(lumina)).toBe(920);
    const combined = combinePortfolio(lumina, null);
    expect(combined.totalUsd).toBe(920);
    expect(combined.netDeltaUsd).toBe(920);
    expect(combined.lighterEquityUsd).toBeNull();
  });

  it("adds Lighter equity and signed perp delta", () => {
    const combined = combinePortfolio(lumina, {
      equity: { total: 400, perps: 350, spot: 50 },
      positions: [
        { side: "long", displaySize: 2, displayMark: 100, marketId: 1, symbol: "ETH", displayAvgEntry: 90, unrealizedPnl: 20, funding: -1, marginMode: "cross" },
        { side: "short", displaySize: 1, displayMark: 50, marketId: 2, symbol: "BTC", displayAvgEntry: 55, unrealizedPnl: 5, funding: 0.5, marginMode: "isolated" },
      ],
    });
    expect(combined.lighterEquityUsd).toBe(400);
    expect(combined.lighterPerpDeltaUsd).toBe(150);
    expect(combined.totalUsd).toBe(1320);
    expect(combined.netDeltaUsd).toBe(1070);
  });
});

describe("freshness", () => {
  it("marks Lighter fresh only from a recent websocket pong", () => {
    expect(lighterFreshness(true, 1_000, 5_000)).toBe("fresh");
    expect(lighterFreshness(true, 1_000, 16_000)).toBe("fresh");
    expect(lighterFreshness(true, 1_000, 16_001)).toBe("stale");
    expect(lighterFreshness(true, 1_000, 20_000)).toBe("stale");
    expect(lighterFreshness(false, null, 5_000)).toBe("offline");
    expect(lighterFreshness(false, 1_000, 2_000)).toBe("stale");
  });

  it("never reports fresh from presence alone", () => {
    // Socket open, no pong yet.
    expect(lighterFreshness(true, null, 5_000)).toBe("unknown");
    // No block stamp yet.
    expect(chainFreshness(undefined, 5_000, 45)).toBe("unknown");
  });

  it("derives Lumina freshness from the age of the block the data was read at", () => {
    const now = 1_000_000_000; // ms
    const nowSec = now / 1000;
    expect(blockAgeSeconds(BigInt(nowSec - 12), now)).toBe(12);
    expect(chainFreshness(BigInt(nowSec - 45), now, 45)).toBe("fresh");
    expect(chainFreshness(BigInt(nowSec - 46), now, 45)).toBe("stale");
    // A block timestamp slightly ahead of the local clock counts as age 0.
    expect(blockAgeSeconds(BigInt(nowSec + 3), now)).toBe(0);
    expect(blockAgeSeconds(BigInt(nowSec), 0)).toBeNull();
  });
});

describe("accountTotals (spec §3.1: one definition for dashboard and portfolio)", () => {
  const E6 = 10n ** 6n;
  const E8 = 10n ** 8n;
  const E18 = 10n ** 18n;
  const USDC = "0xusdc";
  const WETH = "0xweth";
  const ray = (pct: bigint) => pct * 10n ** 25n;
  const stamp = (n: bigint) => ({ number: n, timestamp: 1_700_000_000n + n });

  function input(over: Partial<AccountTotalsInput> = {}): AccountTotalsInput {
    return {
      core: [
        { asset: USDC, decimals: 6, supplied: 10_000n * E6, borrowed: 4_000n * E6 },
        { asset: WETH, decimals: 18, supplied: 0n, borrowed: 0n },
      ],
      coreRatesOf: (a) => (a === USDC ? { supplyRate: ray(5n), borrowRate: ray(8n) } : { supplyRate: undefined, borrowRate: undefined }),
      isolated: [
        {
          // USDC/WETH: lent 1,000 USDC, 1 WETH posted (rate: WETH per USDC × 1e18 at $2,000), 500 USDC debt.
          asset: USDC,
          assetDecimals: 6,
          suppliedAssets: 1_000n * E6,
          borrowedAssets: 500n * E6,
          collateralAmount: E18,
          exchangeRate: 5n * 10n ** 26n,
          lendApr: new Decimal("0.03"),
          borrowApr: new Decimal("0.06"),
        },
      ],
      priceOf: (a) => (a === USDC ? E8 : a === WETH ? 2_000n * E8 : undefined),
      isolatedIncomplete: false,
      stamps: { core: stamp(10n), prices: stamp(9n), isolated: stamp(12n), conversions: stamp(11n), pairs: stamp(13n) },
      ...over,
    };
  }

  it("net worth = core supplied + isolated lent + isolated collateral − core debt − isolated debt", () => {
    const t = accountTotals(input());
    expect(t.legs).toEqual({
      coreSupplied: 10_000n * E8,
      coreDebt: 4_000n * E8,
      isolatedLent: 1_000n * E8,
      isolatedCollateral: 2_000n * E8,
      isolatedDebt: 500n * E8,
    });
    expect(t.deposits).toBe(13_000n * E8);
    expect(t.debt).toBe(4_500n * E8);
    expect(t.netWorth).toBe(8_500n * E8);
    expect(t.incomplete).toBe(false);
  });

  it("net APY = (Σ earning × APY − Σ debt × APY) / net worth; posted collateral earns 0", () => {
    const t = accountTotals(input());
    const expected = coreApy(ray(5n))!
      .mul(10_000)
      .plus(aprToApy("0.03").mul(1_000))
      .minus(coreApy(ray(8n))!.mul(4_000))
      .minus(aprToApy("0.06").mul(500))
      .div(8_500);
    expect(t.netApy!.minus(expected).abs().lt("1e-30")).toBe(true);
  });

  it("the combined stamp is the oldest of core, prices, isolated snapshots, conversions and pairs", () => {
    expect(accountTotals(input()).stamp).toEqual(stamp(9n));
    expect(accountTotals(input({ stamps: { ...input().stamps, conversions: undefined } })).stamp).toBeUndefined();
  });

  it("a collateral-only isolated position still counts", () => {
    const t = accountTotals(
      input({
        core: [],
        isolated: [{ ...input().isolated[0], suppliedAssets: 0n, borrowedAssets: 0n, lendApr: undefined, borrowApr: undefined }],
      }),
    );
    expect(t.netWorth).toBe(2_000n * E8);
    // Only collateral: net worth > 0, nothing earns → 0%, not "—" (the missing APRs belong to zero balances).
    expect(t.netApy!.isZero()).toBe(true);
  });

  it("net APY '—': net worth ≤ 0", () => {
    const zero = accountTotals(input({ isolated: [], core: [{ asset: USDC, decimals: 6, supplied: 1_000n * E6, borrowed: 1_000n * E6 }] }));
    expect(zero.netWorth).toBe(0n);
    expect(zero.netApy).toBeUndefined();
    const negative = accountTotals(input({ isolated: [], core: [{ asset: USDC, decimals: 6, supplied: 0n, borrowed: 1n * E6 }] }));
    expect(negative.netWorth! < 0n).toBe(true);
    expect(negative.netApy).toBeUndefined();
  });

  it("net APY '—': a non-zero position with an unavailable APY", () => {
    const noRate = accountTotals(input({ coreRatesOf: () => undefined }));
    expect(noRate.netWorth).toBe(8_500n * E8);
    expect(noRate.netApy).toBeUndefined();
    const noLendApr = accountTotals(input({ isolated: [{ ...input().isolated[0], lendApr: undefined }] }));
    expect(noLendApr.netApy).toBeUndefined();
  });

  it("net worth and net APY unavailable: a non-zero position with no USD value (price or conversion missing)", () => {
    const noPrice = accountTotals(input({ priceOf: (a) => (a === WETH ? 2_000n * E8 : undefined) }));
    expect(noPrice.netWorth).toBeUndefined();
    expect(noPrice.netApy).toBeUndefined();
    const noConversion = accountTotals(input({ isolated: [{ ...input().isolated[0], borrowedAssets: undefined }] }));
    expect(noConversion.legs.isolatedDebt).toBeUndefined();
    expect(noConversion.netWorth).toBeUndefined();
    const noRate = accountTotals(input({ isolated: [{ ...input().isolated[0], exchangeRate: undefined }] }));
    expect(noRate.legs.isolatedCollateral).toBeUndefined();
  });

  it("zero-balance markets are ignored, even with no rate or price", () => {
    // WETH core market: zero balances, no rates; its price missing too.
    const t = accountTotals(input({ priceOf: (a) => (a === USDC ? E8 : undefined), isolated: [] }));
    expect(t.netWorth).toBe(6_000n * E8);
    expect(t.netApy).toBeDefined();
  });

  it("an incomplete isolated list makes the isolated legs and the totals unavailable, never partial", () => {
    const t = accountTotals(input({ isolatedIncomplete: true }));
    expect(t.incomplete).toBe(true);
    expect(t.legs.coreSupplied).toBe(10_000n * E8);
    expect(t.legs.isolatedLent).toBeUndefined();
    expect(t.netWorth).toBeUndefined();
    expect(t.netApy).toBeUndefined();
  });

  it("a paused pair (APRs 0) still yields a net APY", () => {
    const paused = accountTotals(input({ isolated: [{ ...input().isolated[0], lendApr: new Decimal(0), borrowApr: new Decimal(0) }] }));
    expect(paused.netApy).toBeDefined();
  });
});
