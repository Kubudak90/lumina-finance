import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { formatApy, formatHealthFactor, formatLiquidationPrice, formatUsd8, isValidDecimalInput, safeParseUnits } from "./format";
import { aprToApy, coreApy } from "./risk";

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
    expect(formatLiquidationPrice({ kind: "now" }, "USD")).toBe("Liquidatable now");
    expect(formatLiquidationPrice({ kind: "none" }, "USD")).toBe("None");
    expect(formatLiquidationPrice({ kind: "unavailable", reason: "emode" }, "USD")).toBe("Unavailable");
  });

  it("formatUsd8: base-currency (8 decimals) values, — when unavailable", () => {
    expect(formatUsd8(13_500n * 10n ** 8n)).toBe("$13,500.00");
    expect(formatUsd8(undefined)).toBe("—");
  });
});
