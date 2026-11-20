import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { collateralPerWholeAsset, isolatedCollateralBase8, isolatedCollateralUsd, usdValue } from "./prices";

// Oracle prices (1e8): ETH $2000, USDC $1. LighterDualOracle rate = collateral raw per asset raw × 1e18.
const ETH8 = 2_000n * 10n ** 8n;
const USDC8 = 10n ** 8n;
const RATE_USDC_WETH = 5n * 10n ** 26n; // pair asset USDC, collateral WETH: 1e18 wei per 2000e6
const RATE_WETH_USDC = 2_000n * 10n ** 6n; // pair asset WETH, collateral USDC: 2000e6 per 1e18 wei

describe("isolated collateral USD: one division, rounded at the USD scale (Codex #10)", () => {
  it("USDC/WETH pair: 1e8 wei of WETH is 20 at the 1e8 USD scale, not 0", () => {
    expect(isolatedCollateralBase8(100_000_000n, RATE_USDC_WETH, 6, USDC8)).toBe(20n);
    expect(isolatedCollateralBase8(parseUnits("1", 18), RATE_USDC_WETH, 6, USDC8)).toBe(2_000n * 10n ** 8n);
  });

  it("WETH/USDC pair: 1 raw USDC unit is 100 at the 1e8 scale; 2000 USDC is $2000", () => {
    expect(isolatedCollateralBase8(1n, RATE_WETH_USDC, 18, ETH8)).toBe(100n);
    expect(isolatedCollateralBase8(parseUnits("2000", 6), RATE_WETH_USDC, 18, ETH8)).toBe(2_000n * 10n ** 8n);
  });

  it("orientation: swapping the pair's rate gives a wrong answer (guards the direction)", () => {
    expect(isolatedCollateralBase8(parseUnits("1", 18), RATE_WETH_USDC, 6, USDC8)).not.toBe(2_000n * 10n ** 8n);
    expect(collateralPerWholeAsset(RATE_USDC_WETH, 6)).toBe(parseUnits("0.0005", 18)); // 1 USDC = 0.0005 WETH
    expect(collateralPerWholeAsset(RATE_WETH_USDC, 18)).toBe(parseUnits("2000", 6)); // 1 WETH = 2000 USDC
  });

  it("is unavailable, never zero, without a rate or price", () => {
    expect(isolatedCollateralUsd(1n, undefined, 6, USDC8)).toBeUndefined();
    expect(isolatedCollateralUsd(1n, RATE_USDC_WETH, 6, undefined)).toBeUndefined();
    expect(isolatedCollateralUsd(undefined, RATE_USDC_WETH, 6, USDC8)).toBeUndefined();
    expect(isolatedCollateralUsd(0n, undefined, 6, undefined)).toBe(0);
    expect(usdValue(undefined, 6, USDC8)).toBeUndefined();
  });
});
