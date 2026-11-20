import { describe, expect, it } from "vitest";
import { luminaChain } from "@/lib/chains";
import {
  LIGHTER_L1_CHAIN_ID,
  LIGHTER_REST_URL,
  LIGHTER_SIGNING_CHAIN_ID,
  LIGHTER_TS_VERSION,
  LIGHTER_WASM_URL,
  isLighterPath,
} from "./config";

describe("Lighter domain config", () => {
  it("keeps REST/signing separate from the Lumina wagmi chain", () => {
    expect(LIGHTER_TS_VERSION).toBe("1.0.2");
    expect(LIGHTER_SIGNING_CHAIN_ID).toBe(304);
    expect(LIGHTER_L1_CHAIN_ID).toBe(1);
    expect(LIGHTER_REST_URL).toBe("https://mainnet.zklighter.elliot.ai");
    expect(LIGHTER_REST_URL).not.toContain("http://");
    expect(luminaChain.id).toBe(19529);
    expect(luminaChain.id).not.toBe(LIGHTER_SIGNING_CHAIN_ID);
    expect(luminaChain.id).not.toBe(LIGHTER_L1_CHAIN_ID);
    expect(LIGHTER_WASM_URL).toContain("main.wasm");
  });

  it("identifies the lazy-loaded /lighter route", () => {
    expect(isLighterPath("/lighter")).toBe(true);
    expect(isLighterPath("/lighter/positions")).toBe(true);
    expect(isLighterPath("/markets")).toBe(false);
    expect(isLighterPath(null)).toBe(false);
  });
});
