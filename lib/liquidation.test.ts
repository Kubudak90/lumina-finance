import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  CLOSE_FACTOR_HF_THRESHOLD,
  DEFAULT_LIQUIDATION_CLOSE_FACTOR,
  MAX_LIQUIDATION_CLOSE_FACTOR,
  closeFactorFor,
  maxLiquidatableDebt,
  percentDiv,
  percentMul,
} from "./liquidation";

const hf = (n: string) => parseUnits(n, 18);
const usd8 = (n: number) => BigInt(Math.round(n * 1e8));

// USDC debt (6), WETH collateral (18), ETH $2000, bonus 5% (10500)
const base = {
  userDebt: parseUnits("100", 6),
  collateralBalance: parseUnits("1", 18), // $2000 of collateral: plenty
  debtPrice: usd8(1),
  collateralPrice: usd8(2000),
  debtDecimals: 6,
  collateralDecimals: 18,
  liquidationBonus: 10_500n,
};

describe("Aave v3.2 close factor (LiquidationLogic)", () => {
  it("uses the contract constants", () => {
    expect(DEFAULT_LIQUIDATION_CLOSE_FACTOR).toBe(5_000n);
    expect(MAX_LIQUIDATION_CLOSE_FACTOR).toBe(10_000n);
    expect(CLOSE_FACTOR_HF_THRESHOLD).toBe(950_000_000_000_000_000n);
    expect(closeFactorFor(CLOSE_FACTOR_HF_THRESHOLD)).toBe(10_000n); // `>` threshold → default
    expect(closeFactorFor(CLOSE_FACTOR_HF_THRESHOLD + 1n)).toBe(5_000n);
  });

  it("HF 0.96: 50% of the debt", () => {
    const limit = maxLiquidatableDebt({ ...base, healthFactor: hf("0.96") })!;
    expect(limit.closeFactor).toBe(5_000n);
    expect(limit.maxDebtToCover).toBe(parseUnits("50", 6));
    expect(limit.collateralLimited).toBe(false);
  });

  it("HF 0.90: 100% of the debt (Codex #11)", () => {
    const limit = maxLiquidatableDebt({ ...base, healthFactor: hf("0.90") })!;
    expect(limit.closeFactor).toBe(10_000n);
    expect(limit.maxDebtToCover).toBe(parseUnits("100", 6));
  });

  it("HF 0.90 with little collateral: capped by the collateral at the bonus", () => {
    // 0.03 WETH = $60 of collateral → debt needed = 60 / 1.05 = 57.142857 USDC
    const limit = maxLiquidatableDebt({ ...base, healthFactor: hf("0.90"), collateralBalance: parseUnits("0.03", 18) })!;
    expect(limit.collateralLimited).toBe(true);
    expect(limit.maxDebtToCover).toBe(percentDiv(parseUnits("60", 6), 10_500n));
    expect(limit.maxDebtToCover).toBe(57_142_857n);
  });

  it("nothing is liquidatable at HF >= 1", () => {
    expect(maxLiquidatableDebt({ ...base, healthFactor: hf("1") })).toBeNull();
  });

  it("PercentageMath rounds half up", () => {
    expect(percentMul(3n, 5_000n)).toBe(2n); // 1.5 → 2
    expect(percentDiv(1n, 30_000n)).toBe(0n);
  });
});
