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

describe("isolatedLiquidationEstimate (pair liquidate, exact integer arithmetic)", () => {
  const RATE = 5n * 10n ** 26n; // WETH per USDC × 1e18 ($2000/ETH, USDC 6 decimals → WETH 18)
  const FEES = { cleanLiquidationFee: 5_000n, dirtyLiquidationFee: 4_500n, protocolLiquidationFee: 10_000n };

  it("dirty path: returns collateral seized, protocol fee, collateral received, repayment and zero write-off", () => {
    // 100 USDC repaid out of 1,000 USDC debt against 1 WETH ($2,000).
    // base = 0.05 WETH; dirty (+4.5%) = 0.05225 WETH seized; protocol fee (10% of 0.00225) = 0.000225 WETH;
    // received = 0.052025 WETH; writeOff = 0; borrower collateral left = 1 - 0.05225 = 0.94775 WETH.
    const e = isolatedLiquidationEstimate({
      shares: 100_000_000n,
      borrowerShares: 1_000_000_000n,
      totalBorrow: { amount: 1_000_000_000n, shares: 1_000_000_000n },
      debt: 1_000_000_000n,
      collateral: 10n ** 18n,
      exchangeRate: RATE,
      ...FEES,
    });
    expect(e.repaid).toBe(100_000_000n);
    expect(e.collateralSeized).toBe(52_250_000_000_000_000n);
    expect(e.protocolFee).toBe(225_000_000_000_000n);
    expect(e.collateralReceived).toBe(52_025_000_000_000_000n);
    expect(e.writeOff).toBe(0n);
    expect(e.debtAfter).toBe(900_000_000n);
    expect(e.collateralAfter).toBe(10n ** 18n - 52_250_000_000_000_000n);
    expect(e.isClean).toBe(false);
    expect(e.collateralExhausted).toBe(false);
    expect(e.repaymentExceedsCollateral).toBe(false);
  });

  it("clean partial on underwater position: writes off only unpaid shares and takes protocol fee on bonus only", () => {
    // 3,000 USDC debt, 1 WETH ($2,000). Repay 1,950 USDC (clean: 1950 * 1.05 = 2047.5 >= 2000).
    // base = 0.975 WETH; seized = 1 WETH; bonus = 0.025 WETH; fee = 0.0025 WETH; received = 0.9975 WETH ($1,995 > $1,950).
    // writeOff = 1,050 USDC; borrower debtAfter = 0, collateralAfter = 0.
    const e = isolatedLiquidationEstimate({
      shares: 1_950_000_000n,
      borrowerShares: 3_000_000_000n,
      totalBorrow: { amount: 3_000_000_000n, shares: 3_000_000_000n },
      debt: 3_000_000_000n,
      collateral: 10n ** 18n,
      exchangeRate: RATE,
      ...FEES,
    });
    expect(e.repaid).toBe(1_950_000_000n);
    expect(e.collateralSeized).toBe(10n ** 18n);
    expect(e.protocolFee).toBe(2_500_000_000_000_000n);
    expect(e.collateralReceived).toBe(997_500_000_000_000_000n);
    expect(e.writeOff).toBe(1_050_000_000n);
    expect(e.debtAfter).toBe(0n);
    expect(e.collateralAfter).toBe(0n);
    expect(e.isClean).toBe(true);
    expect(e.collateralExhausted).toBe(true);
    expect(e.repaymentExceedsCollateral).toBe(false);
  });

  it("underwater full repayment flags repaymentExceedsCollateral = true, protocolFee = 0, writeOff = 0", () => {
    const e = isolatedLiquidationEstimate({
      shares: 3_000_000_000n,
      borrowerShares: 3_000_000_000n,
      totalBorrow: { amount: 3_000_000_000n, shares: 3_000_000_000n },
      debt: 3_000_000_000n,
      collateral: 10n ** 18n,
      exchangeRate: RATE,
      ...FEES,
    });
    expect(e).toMatchObject({
      repaid: 3_000_000_000n,
      collateralSeized: 10n ** 18n,
      protocolFee: 0n,
      collateralReceived: 10n ** 18n,
      writeOff: 0n,
      debtAfter: 0n,
      collateralAfter: 0n,
      isClean: true,
      collateralExhausted: true,
      repaymentExceedsCollateral: true,
    });
  });

  it("missing rate, totalBorrow or fees → unavailable (undefined), never 0, no division", () => {
    const base = {
      shares: 100n,
      borrowerShares: 200n,
      totalBorrow: { amount: 200n, shares: 200n },
      debt: 200n,
      collateral: 300n,
      exchangeRate: RATE,
      ...FEES,
    };
    expect(isolatedLiquidationEstimate({ ...base, exchangeRate: undefined })).toMatchObject({
      collateralSeized: undefined,
      protocolFee: undefined,
      collateralReceived: undefined,
      writeOff: undefined,
      collateralAfter: undefined,
    });
    expect(isolatedLiquidationEstimate({ ...base, exchangeRate: 0n }).collateralReceived).toBeUndefined();
    expect(isolatedLiquidationEstimate({ ...base, cleanLiquidationFee: undefined }).collateralReceived).toBeUndefined();
    expect(isolatedLiquidationEstimate({ ...base, totalBorrow: undefined }).repaid).toBeUndefined();
  });
});
