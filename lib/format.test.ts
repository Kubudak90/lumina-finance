import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  formatApy,
  formatExactTokenAmount,
  formatHealthFactor,
  formatLiquidationPrice,
  formatPairPrice,
  formatTokenAmount,
  formatUsd8,
  isValidDecimalInput,
  safeParseUnits,
} from "./format";
import { aprToApy, coreApy } from "./risk";
import { UNAVAILABLE, formatAmount, formatRate, formatToken } from "../components/tx/format";

describe("safeParseUnits", () => {
  it("parses 6-decimal USDC without using Number", () => {
    expect(safeParseUnits("1.5", 6)).toBe(1_500_000n);
    expect(safeParseUnits("1000000.123456", 6)).toBe(1_000_000_123_456n);
  });

  it("rejects more fractional digits than the token allows", () => {
    expect(isValidDecimalInput("1.1234567", 6)).toBe(false);
    expect(safeParseUnits("1.1234567", 6)).toBeNull();
  });

  it("parses values above Number.MAX_SAFE_INTEGER as bigint", () => {
    const raw = "9007199254740993";
    expect(safeParseUnits(raw, 0)).toBe(9007199254740993n);
    expect(BigInt(Number(raw))).not.toBe(9007199254740993n);
  });
});

describe("formatHealthFactor", () => {
  it("renders the Aave max uint as infinity", () => {
    expect(
      formatHealthFactor(BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"))
    ).toBe("∞");
  });
});

describe("formatApy (ui-usability-v1 spec §3.1: APY cells show aprToApy, never the APR)", () => {
  it("a 5% APR (ray or fraction) reads as its per-second compounded APY, 5.13%", () => {
    expect(formatApy(coreApy(5n * 10n ** 25n))).toBe("5.13%");
    expect(formatApy(aprToApy("0.05"))).toBe("5.13%");
    expect(formatApy(aprToApy("0.08"))).toBe("8.33%");
  });

  it("unavailable reads —, zero 0.00%, dust <0.01%, negative keeps its sign", () => {
    expect(formatApy(undefined)).toBe("—");
    expect(formatApy(coreApy(undefined))).toBe("—");
    expect(formatApy(new Decimal(0))).toBe("0.00%");
    expect(formatApy(new Decimal("0.00004"))).toBe("<0.01%");
    expect(formatApy(new Decimal("-0.00004"))).toBe(">-0.01%");
    expect(formatApy(new Decimal("-0.015"))).toBe("-1.50%");
  });
});

describe("formatLiquidationPrice", () => {
  it("formats every kind, in USD (core) or USDC per ETH (isolated), floored to cents", () => {
    expect(formatLiquidationPrice({ kind: "below", price: 123_456_789_999n }, "USD")).toBe("ETH below $1,234.56");
    expect(formatLiquidationPrice({ kind: "above", price: 7_800n * 10n ** 8n }, "USDC")).toBe("ETH above 7,800.00 USDC");
    // One wording on every surface, the modals' (U4 r1 #6).
    expect(formatLiquidationPrice({ kind: "now" }, "USD")).toBe("now (at any ETH price)");
    expect(formatLiquidationPrice({ kind: "none" }, "USD")).toBe("none");
    expect(formatLiquidationPrice({ kind: "unavailable", reason: "emode" }, "USD")).toBe("unavailable");
    expect(formatLiquidationPrice(undefined, "USDC")).toBe("unavailable");
  });

  it("formatUsd8: base-currency (8 decimals) values, — when unavailable", () => {
    expect(formatUsd8(13_500n * 10n ** 8n)).toBe("$13,500.00");
    expect(formatUsd8(undefined)).toBe("—");
  });
});

describe("one APY formatter for pages and modals (U4 review r1 #1)", () => {
  // Every kind of value a page or a modal can be handed, including the cases where the old two
  // formatters disagreed (half-up vs down; the dust floor; non-finite).
  const values: Array<[string, Decimal | undefined]> = [
    ["5% APR (ray)", coreApy(5n * 10n ** 25n)],
    ["3% APR", aprToApy("0.03")],
    ["8% APR", aprToApy("0.08")],
    ["zero", new Decimal(0)],
    ["dust 0.005%", new Decimal("0.00005")],
    ["negative dust", new Decimal("-0.00004")],
    ["exactly 0.01%", new Decimal("0.0001")],
    ["a half: 1.005%", new Decimal("0.01005")],
    ["negative", new Decimal("-0.015")],
    ["NaN", new Decimal(NaN)],
    ["Infinity", new Decimal(Infinity)],
    ["undefined", undefined],
  ];

  it.each(values)("%s: the modal string equals the page string (only the missing-value marker differs)", (_name, v) => {
    expect(formatRate(v)).toBe(formatApy(v, UNAVAILABLE));
    const available = v !== undefined && v.isFinite();
    expect(formatRate(v)).toBe(available ? formatApy(v) : "unavailable");
    expect(formatApy(v)).toBe(available ? formatRate(v) : "—");
  });

  it("the convention: half-up to hundredths, '<0.01%' dust, whatever Decimal configuration built the value", () => {
    expect(formatRate(coreApy(5n * 10n ** 25n))).toBe("5.13%"); // 5.1271…% (the old modal formatter said 5.12%)
    expect(formatRate(aprToApy("0.03"))).toBe("3.05%"); // 3.0454…% (the old modal formatter said 3.04%)
    expect(formatRate(new Decimal("0.00005"))).toBe("<0.01%"); // the old modal formatter said 0.00%
    expect(formatApy(new Decimal("0.01005"))).toBe("1.01%");
    const RoundingDown = Decimal.clone({ rounding: Decimal.ROUND_DOWN });
    expect(formatApy(new RoundingDown("0.051271"))).toBe("5.13%");
    expect(formatRate(new RoundingDown("0.051271"))).toBe("5.13%");
  });
});

describe("one token-amount formatter for every surface (U4 review r1 #2)", () => {
  it("4 fraction digits, rounded DOWN (never half-up), trailing zeros dropped, thousands grouped", () => {
    expect(formatTokenAmount(500_123_490n, 6)).toBe("500.1234"); // accrued debt 500.12349 USDC
    expect(formatTokenAmount(1_234_560_000_000_000_000n, 18)).toBe("1.2345"); // 1.23456 WETH
    expect(formatTokenAmount(999_999n, 6)).toBe("0.9999"); // not "1"
    expect(formatTokenAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatTokenAmount(1_000_000_000_000n, 6)).toBe("1,000,000");
    expect(formatTokenAmount(0n, 18)).toBe("0");
  });

  it("dust: a non-zero amount below 0.0001 reads '<0.0001', never 0; 0.0001 itself is shown", () => {
    expect(formatTokenAmount(40_000_000_000_000n, 18)).toBe("<0.0001"); // 0.00004 WETH
    expect(formatTokenAmount(1n, 6)).toBe("<0.0001");
    expect(formatTokenAmount(1n, 18)).toBe("<0.0001");
    expect(formatTokenAmount(100n, 6)).toBe("0.0001");
  });

  it("is exact for any uint256 (decimal.js, never a float)", () => {
    expect(formatTokenAmount(123_456_789_012_345_678_901_234_567_890_123n, 18)).toBe("123,456,789,012,345.6789");
    const max = (1n << 256n) - 1n;
    expect(formatTokenAmount(max, 18)).toBe(
      "115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457.584", // .58400791… cut to 4 places
    );
    expect(formatTokenAmount(9_007_199_254_740_993n, 0)).toBe("9,007,199,254,740,993");
  });

  it("the modals' helpers are the same formatter (one precision, one rounding, one dust floor)", () => {
    for (const [v, d] of [
      [500_123_490n, 6],
      [1_234_560_000_000_000_000n, 18],
      [40_000_000_000_000n, 18],
      [0n, 6],
      [123_456_789_000_000n, 6],
    ] as const) {
      expect(formatAmount(v, d)).toBe(formatTokenAmount(v, d));
      expect(formatToken(v, d, "USDC")).toBe(`${formatTokenAmount(v, d)} USDC`);
    }
    expect(formatToken(undefined, 6, "USDC")).toBe("unavailable");
  });

  it("a pair price keeps 6 digits (a price, not an amount), rounded down", () => {
    expect(formatPairPrice(500_000_000_000_000n, 18)).toBe("0.0005");
    expect(formatPairPrice(426_315_789_473_684n, 18)).toBe("0.000426");
    expect(formatPairPrice(2_000_000_000n, 6)).toBe("2,000");
  });
});

describe("approval and allowance figures: exact, never rounded (U4 review r2 #1)", () => {
  it("keeps every non-zero fraction digit, drops trailing zeros, groups thousands", () => {
    expect(formatExactTokenAmount(123_456_000_000_000_000n, 18)).toBe("0.123456"); // not 0.1234
    expect(formatExactTokenAmount(50_050_000_000_000_001n, 18)).toBe("0.050050000000000001"); // not 0.05
    expect(formatExactTokenAmount(50_010_000_000_000_000n, 18)).toBe("0.05001");
    expect(formatExactTokenAmount(1_234_567_890_123_456_789_012n, 18)).toBe("1,234.567890123456789012");
    expect(formatExactTokenAmount(959_960_000_000n, 6)).toBe("959,960");
    expect(formatExactTokenAmount(1_500_000n, 6)).toBe("1.5");
    expect(formatExactTokenAmount(0n, 18)).toBe("0");
  });

  it("no dust floor and no float: 1 wei and a full uint256 are exact", () => {
    expect(formatExactTokenAmount(1n, 18)).toBe("0.000000000000000001");
    expect(formatExactTokenAmount(1n, 6)).toBe("0.000001");
    expect(formatExactTokenAmount((1n << 256n) - 1n, 18)).toBe(
      "115,792,089,237,316,195,423,570,985,008,687,907,853,269,984,665,640,564,039,457.584007913129639935",
    );
  });

  it("an allowance short of an approval never reads the same (the 4-place amount formatter would)", () => {
    const allowance = 50_010_000_000_000_000n;
    const approval = 50_050_000_000_000_001n;
    expect(formatTokenAmount(allowance, 18)).toBe(formatTokenAmount(approval, 18)); // both "0.05": why approvals don't use it
    expect(formatExactTokenAmount(allowance, 18)).not.toBe(formatExactTokenAmount(approval, 18));
  });
});
