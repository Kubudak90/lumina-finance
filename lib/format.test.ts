import { describe, expect, it } from "vitest";
import { formatHealthFactor, isValidDecimalInput, safeParseUnits } from "./format";

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
