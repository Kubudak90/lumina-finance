import { describe, expect, it } from "vitest";
import { coreLiquidationEstimate, isolatedLiquidationEstimate } from "./txSummary";
import { percentMul } from "./liquidation";

const E8 = 10n ** 8n;

describe("coreLiquidationEstimate (Aave v3.2 seizure)", () => {
  const base = {
    maxDebtToCover: 50_000_000n, // 50 USDC
    debt: 100_000_000n, // 100 USDC
    collateral: 10n ** 18n, // 1 WETH
    debtPrice: 1n * E8,
    collateralPrice: 2_000n * E8,
    debtDecimals: 6,
    collateralDecimals: 18,
    liquidationBonus: 10_500n,
  };

  it("repays min(amount, max, debt) and seizes its value times the bonus", () => {
    const e = coreLiquidationEstimate({ ...base, amount: 40_000_000n });
    expect(e.repaid).toBe(40_000_000n);
    expect(e.debtAfter).toBe(60_000_000n);
    // 40 USDC at $2000/WETH = 0.02 WETH, × 1.05 = 0.021 WETH.
    const seized = percentMul(2n * 10n ** 16n, 10_500n);
    expect(e.collateralAfter).toBe(10n ** 18n - seized);
    expect(e.collateralExhausted).toBe(false);
  });

  it("an amount above the max is reduced to the max (the pool does the same)", () => {
    expect(coreLiquidationEstimate({ ...base, amount: 90_000_000n }).repaid).toBe(50_000_000n);
  });

  it("unavailable inputs stay undefined, never 0; a zero price never divides", () => {
    expect(coreLiquidationEstimate({ ...base, amount: 1n, debt: undefined })).toMatchObject({ repaid: undefined, debtAfter: undefined, collateralAfter: undefined });
    expect(coreLiquidationEstimate({ ...base, amount: 1n, collateralPrice: 0n }).collateralAfter).toBeUndefined();
    expect(coreLiquidationEstimate({ ...base, amount: 1n, liquidationBonus: undefined }).collateralAfter).toBeUndefined();
  });

  it("a seizure above the balance clamps the remaining collateral at 0", () => {
    const e = coreLiquidationEstimate({ ...base, amount: 50_000_000n, collateral: 10n ** 16n });
    expect(e.collateralAfter).toBe(0n);
    expect(e.collateralExhausted).toBe(true);
  });
});

describe("isolatedLiquidationEstimate (pair liquidate)", () => {
  const RATE = 5n * 10n ** 26n; // WETH per USDC × 1e18 ($2000/ETH, USDC 6 decimals → WETH 18)

  it("removes the repaid value in collateral at the pair rate (fee not included: an upper bound)", () => {
    const e = isolatedLiquidationEstimate({ shareValue: 100_000_000n, debt: 1_000_000_000n, collateral: 10n ** 18n, exchangeRate: RATE });
    expect(e.repaid).toBe(100_000_000n);
    expect(e.debtAfter).toBe(900_000_000n);
    expect(e.collateralAfter).toBe(10n ** 18n - 5n * 10n ** 16n); // 100 USDC = 0.05 WETH
  });

  it("the clean path: the value uses up the collateral → all of it and the rest of the debt go", () => {
    const e = isolatedLiquidationEstimate({ shareValue: 3_000_000_000n, debt: 3_000_000_000n, collateral: 10n ** 18n, exchangeRate: RATE });
    expect(e).toMatchObject({ collateralAfter: 0n, debtAfter: 0n, collateralExhausted: true });
  });

  it("no rate (or a zero rate) → collateral unavailable, no division", () => {
    expect(isolatedLiquidationEstimate({ shareValue: 1n, debt: 2n, collateral: 3n, exchangeRate: undefined }).collateralAfter).toBeUndefined();
    expect(isolatedLiquidationEstimate({ shareValue: 1n, debt: 2n, collateral: 3n, exchangeRate: 0n }).collateralAfter).toBeUndefined();
    expect(isolatedLiquidationEstimate({ shareValue: undefined, debt: 2n, collateral: 3n, exchangeRate: RATE }).repaid).toBeUndefined();
  });
});
