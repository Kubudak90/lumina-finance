import { describe, expect, it } from "vitest";
import { decideFollowUp, startFollowUp } from "./approvalFlow";

const ALICE = "0x000000000000000000000000000000000000a11c" as const;
const BOB = "0x0000000000000000000000000000000000000b0b" as const;
const H1 = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const H2 = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

const pending = { ...startFollowUp(ALICE, 19529, "100", { amount: 100n }), approvalHash: H1 };
const ok = { account: ALICE, chainId: 19529, paramsKey: "100", receipt: { transactionHash: H1, status: "success" as const } };

describe("approval → follow-up binding (Codex #3)", () => {
  it("proceeds only on the receipt of the exact approval, unchanged account/chain/inputs", () => {
    expect(decideFollowUp(pending, ok)).toEqual({ kind: "proceed", params: { amount: 100n } });
  });

  it("cancels on an account switch, a chain switch or changed inputs", () => {
    expect(decideFollowUp(pending, { ...ok, account: BOB }).kind).toBe("cancel");
    expect(decideFollowUp(pending, { ...ok, account: undefined }).kind).toBe("cancel");
    expect(decideFollowUp(pending, { ...ok, chainId: 1 }).kind).toBe("cancel");
    expect(decideFollowUp(pending, { ...ok, paramsKey: "500" }).kind).toBe("cancel");
  });

  it("never proceeds on another transaction's receipt (a retry cannot reuse an old one)", () => {
    const retry = { ...startFollowUp(ALICE, 19529, "100", { amount: 100n }), approvalHash: H2 };
    expect(decideFollowUp(retry, ok)).toEqual({ kind: "wait" });
    const noHashYet = startFollowUp(ALICE, 19529, "100", { amount: 100n });
    expect(decideFollowUp(noHashYet, ok)).toEqual({ kind: "wait" });
  });

  it("cancels on a reverted approval and idles without a flow", () => {
    expect(decideFollowUp(pending, { ...ok, receipt: { transactionHash: H1, status: "reverted" } }).kind).toBe("cancel");
    expect(decideFollowUp(null, ok)).toEqual({ kind: "idle" });
  });
});
