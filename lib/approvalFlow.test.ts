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

  it("proceeds on a verified same-call repriced replacement of the bound approval (N-FE-02 / F8)", () => {
    const repricedReceipt = {
      transactionHash: H2,
      originalHash: H1,
      status: "success" as const,
      replaced: "repriced" as const,
    };
    expect(decideFollowUp(pending, { ...ok, receipt: repricedReceipt })).toEqual({ kind: "proceed", params: { amount: 100n } });

    // A retry bound to H2 must never accept a stale repriced receipt whose originalHash was H1.
    const H3 = "0x3333333333333333333333333333333333333333333333333333333333333333" as const;
    const retry = { ...startFollowUp(ALICE, 19529, "100", { amount: 100n }), approvalHash: H3 };
    expect(decideFollowUp(retry, { ...ok, receipt: repricedReceipt })).toEqual({ kind: "wait" });

    // Without replaced: "repriced", a different transactionHash never proceeds even if originalHash is set.
    expect(decideFollowUp(pending, { ...ok, receipt: { transactionHash: H2, originalHash: H1, status: "success" } })).toEqual({
      kind: "wait",
    });
  });

  it("cancels when the bound approval was cancelled or replaced by a different call (N-FE-02 / F8)", () => {
    expect(decideFollowUp(pending, { ...ok, receipt: undefined, cancelledHash: H1 })).toEqual({
      kind: "cancel",
      reason: "the approval was cancelled",
    });
    expect(
      decideFollowUp(pending, {
        ...ok,
        receipt: undefined,
        receiptErrorHash: H1,
        receiptErrorReason: "the approval was replaced by a different call",
      }),
    ).toEqual({
      kind: "cancel",
      reason: "the approval was replaced by a different call",
    });
  });
});
