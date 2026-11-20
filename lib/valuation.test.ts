import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { coreBorrowMaxFromReads, isolatedBorrowMaxFromReads } from "./borrowMax";
import { coreLegsUsd, isolatedLegsUsd, oldestStamp } from "./valuation";

const USDC = "0x00000000000000000000000000000000000000c1";
const WETH = "0x00000000000000000000000000000000000000e1";
const prices: Record<string, bigint> = { [USDC]: 10n ** 8n, [WETH]: 2_000n * 10n ** 8n };
const priceOf = (a: string) => prices[a];
const usd8 = (n: number) => BigInt(Math.round(n * 1e8));

describe("failed subqueries are unavailable, never zero (Codex #9)", () => {
  it("core MAX: USDC cap 500, debt 490, LTV capacity 100 → 9.9 when getTotalDebt loads, unavailable when it fails", () => {
    const reads = {
      availableBorrowsBase: usd8(100),
      assetPriceBase: usd8(1),
      decimals: 6,
      availableLiquidity: parseUnits("10000", 6),
      borrowCapTokens: 500n,
      totalDebt: parseUnits("490", 6) as bigint | undefined,
    };
    expect(coreBorrowMaxFromReads(reads)).toBe(parseUnits("10", 6)); // cap headroom, not 99
    expect(coreBorrowMaxFromReads({ ...reads, totalDebt: undefined })).toBeNull();
    expect(coreBorrowMaxFromReads({ ...reads, availableLiquidity: undefined })).toBeNull();
    expect(coreBorrowMaxFromReads({ ...reads, borrowCapTokens: undefined })).toBeNull();
    // No cap: totalDebt is not needed.
    expect(coreBorrowMaxFromReads({ ...reads, borrowCapTokens: 0n, totalDebt: undefined })).toBe(parseUnits("99", 6));
  });

  it("isolated MAX is unavailable when the user's debt conversion failed", () => {
    const reads = {
      collateral: parseUnits("1", 18),
      currentDebt: 0n as bigint | undefined,
      exchangeRate: 5n * 10n ** 26n,
      maxLtv: 75_000n,
      availableLiquidity: parseUnits("100000", 6),
      borrowLimit: (1n << 200n) as bigint | undefined,
      totalBorrow: 0n,
    };
    expect(isolatedBorrowMaxFromReads(reads)).toBe(parseUnits("1485", 6));
    expect(isolatedBorrowMaxFromReads({ ...reads, currentDebt: undefined })).toBeNull();
    expect(isolatedBorrowMaxFromReads({ ...reads, borrowLimit: undefined })).toBeNull();
  });

  it("portfolio: a 100-USDC isolated debt whose toBorrowAmount failed is unavailable, not $0", () => {
    const position = {
      asset: USDC,
      assetDecimals: 6,
      suppliedAssets: 0n,
      borrowedAssets: undefined as bigint | undefined,
      collateralAmount: parseUnits("1", 18),
      exchangeRate: 5n * 10n ** 26n,
    };
    expect(isolatedLegsUsd([position], priceOf).debt).toBeUndefined();
    expect(isolatedLegsUsd([{ ...position, borrowedAssets: parseUnits("100", 6) }], priceOf).debt).toBe(100);
    expect(isolatedLegsUsd([{ ...position, borrowedAssets: parseUnits("100", 6) }], priceOf, true).debt).toBeUndefined();
  });

  it("core legs: a failed balance read is unavailable", () => {
    const ok = { asset: WETH, decimals: 18, supplied: parseUnits("1", 18), borrowed: 0n, collateral: parseUnits("1", 18) };
    expect(coreLegsUsd([ok], priceOf).supplied).toBe(2000);
    expect(coreLegsUsd([{ ...ok, supplied: undefined }], priceOf).supplied).toBeUndefined();
  });

  it("a valuation is as old as its oldest input, and has no age while any input is missing", () => {
    const a = { number: 100n, timestamp: 1000n };
    const b = { number: 90n, timestamp: 990n };
    expect(oldestStamp([a, b])).toBe(b);
    expect(oldestStamp([a, undefined])).toBeUndefined();
  });
});
