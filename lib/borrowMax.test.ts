import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  BORROW_MAX_HAIRCUT_BPS,
  BPS,
  EXCHANGE_PRECISION,
  LTV_PRECISION,
  coreBorrowMax,
  isolatedBorrowMax,
  isolatedLtv,
} from "./borrowMax";

const usd8 = (n: number) => BigInt(Math.round(n * 1e8));

describe("core borrow MAX (LTV-based, FE-05)", () => {
  const base = {
    availableLiquidity: parseUnits("1000000", 6),
    borrowCapTokens: 0n,
    totalDebt: 0n,
  };

  it("is 99% of availableBorrowsBase at the oracle price (USDC, 6 decimals)", () => {
    const max = coreBorrowMax({ ...base, availableBorrowsBase: usd8(750), assetPriceBase: usd8(1), decimals: 6 });
    expect(max).toBe(parseUnits("742.5", 6));
  });

  it("is 99% of availableBorrowsBase at the oracle price (WETH, 18 decimals)", () => {
    const max = coreBorrowMax({
      availableBorrowsBase: usd8(3000),
      assetPriceBase: usd8(2000),
      decimals: 18,
      availableLiquidity: parseUnits("100", 18),
      borrowCapTokens: 0n,
      totalDebt: 0n,
    });
    expect(max).toBe(parseUnits("1.485", 18));
  });

  it("floors in bigint to the token's base units", () => {
    // $1 of capacity at $7: 0.99 / 7 = 0.14142857142857142857… WETH
    const max = coreBorrowMax({
      availableBorrowsBase: usd8(1),
      assetPriceBase: usd8(7),
      decimals: 18,
      availableLiquidity: parseUnits("100", 18),
      borrowCapTokens: 0n,
      totalDebt: 0n,
    });
    expect(max).toBe(141428571428571428n);
    // never above the haircut capacity, and one more wei would be
    const unit = 10n ** 18n;
    expect(max * usd8(7) * BPS).toBeLessThanOrEqual(usd8(1) * BORROW_MAX_HAIRCUT_BPS * unit);
    expect((max + 1n) * usd8(7) * BPS).toBeGreaterThan(usd8(1) * BORROW_MAX_HAIRCUT_BPS * unit);
  });

  it("stays below what Aave's LTV check allows", () => {
    // collateral $10,000 at LTV 75%, debt $2,000: Aave allows (debt + x) / 0.75 <= collateral
    const collateral = usd8(10_000);
    const debt = usd8(2_000);
    const available = (collateral * 7_500n) / 10_000n - debt;
    const max = coreBorrowMax({ ...base, availableBorrowsBase: available, assetPriceBase: usd8(1), decimals: 6 });
    const maxBase = (max * usd8(1)) / 10n ** 6n;
    expect(((debt + maxBase) * 10_000n) / 7_500n).toBeLessThanOrEqual(collateral);
  });

  it("is capped by reserve liquidity", () => {
    const max = coreBorrowMax({
      ...base,
      availableBorrowsBase: usd8(750),
      assetPriceBase: usd8(1),
      decimals: 6,
      availableLiquidity: parseUnits("100", 6),
    });
    expect(max).toBe(parseUnits("100", 6));
  });

  it("is capped by the borrow-cap headroom (cap in whole tokens, 0 = none)", () => {
    const args = { ...base, availableBorrowsBase: usd8(750), assetPriceBase: usd8(1), decimals: 6 };
    expect(coreBorrowMax({ ...args, borrowCapTokens: 500n, totalDebt: parseUnits("450", 6) })).toBe(parseUnits("50", 6));
    expect(coreBorrowMax({ ...args, borrowCapTokens: 500n, totalDebt: parseUnits("600", 6) })).toBe(0n);
    expect(coreBorrowMax({ ...args, borrowCapTokens: 0n, totalDebt: parseUnits("600", 6) })).toBe(parseUnits("742.5", 6));
  });

  it("is zero without a price or capacity", () => {
    expect(coreBorrowMax({ ...base, availableBorrowsBase: usd8(750), assetPriceBase: 0n, decimals: 6 })).toBe(0n);
    expect(coreBorrowMax({ ...base, availableBorrowsBase: 0n, assetPriceBase: usd8(1), decimals: 6 })).toBe(0n);
  });
});

describe("isolated borrow MAX (pair maxLTV and exchange rate)", () => {
  // USDC/WETH pair: asset USDC (6), collateral WETH (18), ETH = $2000.
  // rate = collateral raw per asset raw × 1e18 = 1e18 wei / 2000e6 = 5e8 → 5e26
  const RATE = 5n * 10n ** 26n;
  const base = {
    currentDebt: 0n,
    exchangeRate: RATE,
    maxLtv: 75_000n,
    availableLiquidity: parseUnits("1000000", 6),
    borrowLimit: (1n << 256n) - 1n,
    totalBorrow: 0n,
  };

  it("is 99% of the room under maxLTV at the pair's rate", () => {
    // 1 WETH × 75% = $1500 → 1485 USDC
    expect(isolatedBorrowMax({ ...base, collateral: parseUnits("1", 18) })).toBe(parseUnits("1485", 6));
    // existing debt 1000 → room 500 → 495
    expect(isolatedBorrowMax({ ...base, collateral: parseUnits("1", 18), currentDebt: parseUnits("1000", 6) })).toBe(
      parseUnits("495", 6),
    );
  });

  it("keeps the position solvent by the pair's own check", () => {
    for (const human of ["0.000123456789", "1", "3.3"]) {
      const collateral = parseUnits(human, 18);
      const currentDebt = human === "3.3" ? parseUnits("10", 6) : 0n;
      const max = isolatedBorrowMax({ ...base, collateral, currentDebt });
      const ltv = isolatedLtv(currentDebt + max, collateral, RATE);
      expect(ltv).not.toBeNull();
      expect(ltv!).toBeLessThanOrEqual(75_000n);
    }
  });

  it("works the other way round (WETH borrowed against USDC)", () => {
    // WETH/USDC pair: rate = USDC raw per wei × 1e18 = 2000e6 / 1e18 × 1e18 = 2000e6
    const rate = 2_000n * 10n ** 6n;
    const max = isolatedBorrowMax({
      ...base,
      exchangeRate: rate,
      availableLiquidity: parseUnits("100", 18),
      collateral: parseUnits("2000", 6), // $2000 → 0.75 WETH capacity
    });
    expect(max).toBe(parseUnits("0.7425", 18));
  });

  it("is capped by pair liquidity and by the borrow limit", () => {
    const collateral = parseUnits("1", 18);
    expect(isolatedBorrowMax({ ...base, collateral, availableLiquidity: parseUnits("100", 6) })).toBe(parseUnits("100", 6));
    expect(
      isolatedBorrowMax({ ...base, collateral, borrowLimit: parseUnits("5000", 6), totalBorrow: parseUnits("4900", 6) }),
    ).toBe(parseUnits("100", 6));
    expect(isolatedBorrowMax({ ...base, collateral, borrowLimit: 0n })).toBe(0n);
  });

  it("is zero without a rate, LTV or collateral", () => {
    expect(isolatedBorrowMax({ ...base, collateral: parseUnits("1", 18), exchangeRate: 0n })).toBe(0n);
    expect(isolatedBorrowMax({ ...base, collateral: parseUnits("1", 18), maxLtv: 0n })).toBe(0n);
    expect(isolatedBorrowMax({ ...base, collateral: 0n })).toBe(0n);
  });

  it("computes LTV across different decimals (FE-11)", () => {
    // 1500 USDC against 1 WETH at $2000 = 75%
    expect(isolatedLtv(parseUnits("1500", 6), parseUnits("1", 18), RATE)).toBe(75_000n);
    expect(isolatedLtv(1n, 0n, RATE)).toBeNull();
    expect(LTV_PRECISION).toBe(100_000n);
    expect(EXCHANGE_PRECISION).toBe(10n ** 18n);
  });
});
