import { describe, expect, it } from "vitest";
import {
  applySlippage,
  BPS_DENOMINATOR,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_SWAP_DEADLINE_SECONDS,
  isAllowedSlippageBps,
  minAmountOutFromQuote,
  quoteExactIn,
  swapDeadline,
} from "./slippage";

describe("quoteExactIn", () => {
  it("converts 6-decimal USDC into 18-decimal WETH", () => {
    const usdc = 1_000n * 10n ** 6n;
    const usdcPrice = 1n * 10n ** 8n;
    const wethPrice = 2_000n * 10n ** 8n;
    expect(quoteExactIn(usdc, 6, 18, usdcPrice, wethPrice)).toBe(5n * 10n ** 17n);
  });

  it("converts 18-decimal WETH into 6-decimal USDC", () => {
    const weth = 10n ** 18n;
    const wethPrice = 2_400n * 10n ** 8n;
    const usdcPrice = 1n * 10n ** 8n;
    expect(quoteExactIn(weth, 18, 6, wethPrice, usdcPrice)).toBe(2_400n * 10n ** 6n);
  });

  it("handles 8-decimal tokens without using Number", () => {
    const amountIn = 12_345_678n;
    const quoted = quoteExactIn(amountIn, 8, 8, 150_000_000n, 50_000_000n);
    expect(quoted).toBe((amountIn * 150_000_000n) / 50_000_000n);
  });

  it("returns 0 when a price is missing or zero", () => {
    expect(quoteExactIn(1n, 18, 18, 0n, 1n)).toBe(0n);
    expect(quoteExactIn(1n, 18, 18, 1n, 0n)).toBe(0n);
    expect(quoteExactIn(0n, 18, 18, 1n, 1n)).toBe(0n);
  });

  it("returns 0 when truncation would round a dust quote to nothing", () => {
    expect(quoteExactIn(1n, 18, 6, 1n, 10n ** 18n)).toBe(0n);
  });
});

describe("applySlippage", () => {
  it("applies 50/100/200 bps haircuts without floating point", () => {
    const quoted = 1_000_000n;
    expect(applySlippage(quoted, 50)).toBe(995_000n);
    expect(applySlippage(quoted, 100)).toBe(990_000n);
    expect(applySlippage(quoted, 200)).toBe(980_000n);
    expect(applySlippage(quoted, DEFAULT_SLIPPAGE_BPS)).toBe(990_000n);
  });

  it("fails closed on invalid bps and zero quotes", () => {
    expect(applySlippage(1_000n, -1)).toBe(0n);
    expect(applySlippage(1_000n, 10_000)).toBe(0n);
    expect(applySlippage(1_000n, 1.5)).toBe(0n);
    expect(applySlippage(0n, 100)).toBe(0n);
  });

  it("rounds dust quotes to 0 so the UI must refuse unprotected submits", () => {
    expect(applySlippage(1n, 50)).toBe(0n);
    expect(applySlippage(1n, 100)).toBe(0n);
  });

  it("keeps a nonzero floor on quotes at or above 1 bps unit", () => {
    for (const bps of [50, 100, 200] as const) {
      expect(applySlippage(BPS_DENOMINATOR, bps) > 0n).toBe(true);
    }
  });
});

describe("minAmountOutFromQuote", () => {
  it("returns 0 when oracle prices are undefined so the UI cannot submit", () => {
    expect(minAmountOutFromQuote(1n, 18, 18, undefined, 1n, 100)).toBe(0n);
    expect(minAmountOutFromQuote(1n, 18, 18, 1n, undefined, 100)).toBe(0n);
  });

  it("quotes then haircuts a 6-decimal flash loan into 18-decimal collateral", () => {
    const flashloan = 100n * 10n ** 6n;
    const minOut = minAmountOutFromQuote(flashloan, 6, 18, 10n ** 8n, 2_000n * 10n ** 8n, 100);
    const expected = quoteExactIn(flashloan, 6, 18, 10n ** 8n, 2_000n * 10n ** 8n);
    expect(minOut).toBe(applySlippage(expected, 100));
    expect(minOut > 0n).toBe(true);
  });
});

describe("isAllowedSlippageBps", () => {
  it("accepts only the UI presets", () => {
    expect(isAllowedSlippageBps(50)).toBe(true);
    expect(isAllowedSlippageBps(0)).toBe(false);
    expect(isAllowedSlippageBps(150)).toBe(false);
  });
});

describe("swapDeadline", () => {
  it("uses a 5-minute window", () => {
    expect(DEFAULT_SWAP_DEADLINE_SECONDS).toBe(300);
    expect(swapDeadline(1_700_000_000)).toBe(1_700_000_000n + 300n);
  });

  it("rejects a non-positive ttl", () => {
    expect(() => swapDeadline(1, 0)).toThrow(/positive integer/);
  });
});
