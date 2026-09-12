import { describe, expect, it } from "vitest";
import { redactForLog } from "./errors";

describe("redactForLog", () => {
  it("redacts secret-shaped keys and long hex values", () => {
    const seed = `0x${"ab".repeat(32)}`;
    expect(
      redactForLog({
        seed,
        api_key: "desktop-key",
        authToken: "tok",
        pk: seed,
        ok: "ETH",
      })
    ).toEqual({
      seed: "[redacted]",
      api_key: "[redacted]",
      authToken: "[redacted]",
      pk: "[redacted]",
      ok: "ETH",
    });
  });

  it("redacts hex material inside Error messages", () => {
    const hex = `0x${"cd".repeat(32)}`;
    expect(redactForLog(new Error(`createClient failed ${hex}`))).toEqual({
      name: "Error",
      message: "createClient failed [redacted]",
    });
  });
});
