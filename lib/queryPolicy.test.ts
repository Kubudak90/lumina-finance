import { describe, expect, it } from "vitest";
import { QUERY, defaultQueryClientOptions } from "./queryPolicy";
import { describeWrite } from "./txPreview";

describe("query policy", () => {
  it("does not poll user reads on a global interval", () => {
    expect(QUERY.user.refetchInterval).toBe(false);
    expect(defaultQueryClientOptions().queries.refetchInterval).toBe(false);
  });

  it("polls markets slower than the old 15s global timer", () => {
    expect(QUERY.market.refetchInterval).toBeGreaterThan(15_000);
    expect(QUERY.config.refetchInterval).toBe(60_000);
  });
});

describe("describeWrite", () => {
  it("pairs ABI input names with bigint args", () => {
    const preview = describeWrite({
      address: "0xCe390a9B81841c077bC4541f16D53d2a01bdEb39",
      functionName: "supply",
      args: ["0x57d6EB79ea08D10d7e03865cb1820f01F82255c4", 1_000_000n, "0xabc", 0],
      abi: [
        {
          type: "function",
          name: "supply",
          inputs: [
            { name: "asset" },
            { name: "amount" },
            { name: "onBehalfOf" },
            { name: "referralCode" },
          ],
        },
      ],
    });
    expect(preview.functionName).toBe("supply");
    expect(preview.args).toEqual([
      { name: "asset", value: "0x57d6EB79ea08D10d7e03865cb1820f01F82255c4" },
      { name: "amount", value: "1000000" },
      { name: "onBehalfOf", value: "0xabc" },
      { name: "referralCode", value: "0" },
    ]);
  });
});
