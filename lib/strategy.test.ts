import { describe, expect, it } from "vitest";
import { curveStrategy } from "./strategy";

const LISTED = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

describe("rate-curve strategy (Codex #2)", () => {
  it("reads only the manifest's strategy while the reserve reports the same one", () => {
    expect(curveStrategy(LISTED, LISTED)).toBe(LISTED);
    expect(curveStrategy(LISTED, LISTED.toUpperCase().replace("0X", "0x") as `0x${string}`)).toBe(LISTED);
  });

  it("never returns an unlisted address", () => {
    expect(curveStrategy(LISTED, OTHER)).toBeNull();
    expect(curveStrategy(null, OTHER)).toBeNull();
    expect(curveStrategy(LISTED, undefined)).toBeNull();
  });
});
