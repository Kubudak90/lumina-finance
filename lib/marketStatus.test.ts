import { describe, expect, it } from "vitest";
import { marketStatus } from "./marketStatus";

const config = { isActive: true, isFrozen: false };

describe("market status (Gemini r2 m3)", () => {
  it("is Unknown when getPaused or the configuration read failed", () => {
    expect(marketStatus({ loaded: true, paused: undefined, config })).toBe("Unknown");
    expect(marketStatus({ loaded: true, paused: false, config: undefined })).toBe("Unknown");
    expect(marketStatus({ loaded: false, paused: false, config })).toBe("Unknown");
  });

  it("reports the on-chain state when every read succeeded", () => {
    expect(marketStatus({ loaded: true, paused: true, config })).toBe("Paused");
    expect(marketStatus({ loaded: true, paused: false, config: { isActive: true, isFrozen: true } })).toBe("Frozen");
    expect(marketStatus({ loaded: true, paused: false, config })).toBe("Active");
    expect(marketStatus({ loaded: true, paused: false, config: { isActive: false, isFrozen: false } })).toBe("Inactive");
  });
});
