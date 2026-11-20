import { describe, expect, it } from "vitest";
import { GUARD_STATUS, describeGuardStatus } from "./guard";

const bounds = { maxRefAgeSec: 180, maxDeviationBps: 300, maxCorePriceAgeSec: 600 };

describe("guard borrowStatus", () => {
  it("mirrors LuminaPriceGuard.Status in order", () => {
    expect(GUARD_STATUS).toEqual([
      "OK",
      "PAUSED",
      "NO_MARKETS",
      "NO_REFERENCE",
      "REFERENCE_STALE",
      "CORE_PRICE_STALE",
      "CORE_READ_FAILED",
      "DEVIATION",
    ]);
  });

  it("only OK allows borrows, and every block has a reason", () => {
    expect(describeGuardStatus(0, 0, bounds).borrowAllowed).toBe(true);
    for (let code = 1; code < GUARD_STATUS.length; code++) {
      const s = describeGuardStatus(code, 0, bounds);
      expect(s.borrowAllowed).toBe(false);
      expect(s.message.length).toBeGreaterThan(10);
    }
    expect(describeGuardStatus(4, 0, bounds).message).toMatch(/keeper reference price for ETH \(market 0\) is older than 180s/);
    expect(describeGuardStatus(7, 0, bounds).message).toMatch(/3%/);
  });

  it("treats an unreadable or unknown status as blocked", () => {
    expect(describeGuardStatus(undefined, 0, bounds)).toMatchObject({ key: "UNKNOWN", borrowAllowed: false });
    expect(describeGuardStatus(99, 0, bounds)).toMatchObject({ key: "UNKNOWN", borrowAllowed: false });
  });
});
