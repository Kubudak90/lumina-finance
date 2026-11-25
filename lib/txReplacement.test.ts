import { describe, expect, it } from "vitest";
import {
  TransactionCancelledError,
  TransactionReplacedError,
  classifyReplacement,
  isTransactionCancelledError,
  resolveWriteReceipt,
  type ExpectedCall,
  type ReplacementEventLike,
} from "./txReplacement";

const ALICE = "0x000000000000000000000000000000000000a11c" as const;
const CONTRACT = "0x0000000000000000000000000000000000000200" as const;
const OTHER = "0x0000000000000000000000000000000000000999" as const;
const H1 = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const H2 = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const CALLDATA = "0x095ea7b30000000000000000000000000000000000000000000000000000000000000001" as const;
const OTHER_DATA = "0x095ea7b30000000000000000000000000000000000000000000000000000000000000002" as const;

const EXPECTED: ExpectedCall = { to: CONTRACT, value: 0n, data: CALLDATA };

describe("classifyReplacement (N-FE-02 / F8)", () => {
  it("same call repeated (repriced) → kind 'repriced'", () => {
    const event: ReplacementEventLike = {
      reason: "repriced",
      replacedTransaction: { hash: H1, from: ALICE, to: CONTRACT, value: 0n, input: CALLDATA },
      transaction: { hash: H2, from: ALICE, to: CONTRACT, value: 0n, input: CALLDATA },
    };
    expect(classifyReplacement(event, EXPECTED)).toEqual({
      originalHash: H1,
      replacementHash: H2,
      kind: "repriced",
    });
  });

  it("0-value self-transfer cancellation → kind 'cancelled'", () => {
    const event: ReplacementEventLike = {
      reason: "cancelled",
      replacedTransaction: { hash: H1, from: ALICE, to: CONTRACT, value: 0n, input: CALLDATA },
      transaction: { hash: H2, from: ALICE, to: ALICE, value: 0n, input: "0x" },
    };
    expect(classifyReplacement(event, EXPECTED)).toEqual({
      originalHash: H1,
      replacementHash: H2,
      kind: "cancelled",
    });
  });

  it("changed calldata, target or value → kind 'replaced' (failure), even if reason claims repriced", () => {
    const changedData: ReplacementEventLike = {
      reason: "replaced",
      replacedTransaction: { hash: H1, from: ALICE, to: CONTRACT, value: 0n, input: CALLDATA },
      transaction: { hash: H2, from: ALICE, to: CONTRACT, value: 0n, input: OTHER_DATA },
    };
    expect(classifyReplacement(changedData, EXPECTED).kind).toBe("replaced");

    // Defensive check: even if reason claimed "repriced" with mismatched calldata against expectedCall.
    expect(classifyReplacement({ ...changedData, reason: "repriced" }, EXPECTED).kind).toBe("replaced");

    const changedTarget: ReplacementEventLike = {
      reason: "replaced",
      replacedTransaction: { hash: H1, from: ALICE, to: CONTRACT, value: 0n, input: CALLDATA },
      transaction: { hash: H2, from: ALICE, to: OTHER, value: 0n, input: CALLDATA },
    };
    expect(classifyReplacement(changedTarget, EXPECTED).kind).toBe("replaced");

    const changedValue: ReplacementEventLike = {
      reason: "replaced",
      replacedTransaction: { hash: H1, from: ALICE, to: CONTRACT, value: 0n, input: CALLDATA },
      transaction: { hash: H2, from: ALICE, to: CONTRACT, value: 1n, input: CALLDATA },
    };
    expect(classifyReplacement(changedValue, EXPECTED).kind).toBe("replaced");
  });
});

describe("resolveWriteReceipt (N-FE-02 / F8)", () => {
  const receiptH2 = { transactionHash: H2, status: "success" as const, blockNumber: 105n, logs: [] };

  it("unreplaced success receipt succeeds with originalHash === transactionHash", () => {
    const r = resolveWriteReceipt({
      sentHash: H1,
      receipt: { transactionHash: H1, status: "success", blockNumber: 100n, logs: [] },
      receiptError: null,
      replacement: null,
    });
    expect(r.isSuccess).toBe(true);
    expect(r.isCancelled).toBe(false);
    expect(r.hash).toBe(H1);
    expect(r.receipt).toMatchObject({ transactionHash: H1, originalHash: H1, blockNumber: 100n });
    expect(r.receiptError).toBeNull();
  });

  it("verified same-call replacement (repriced) succeeds and carries the replacement receipt and hash", () => {
    const r = resolveWriteReceipt({
      sentHash: H1,
      receipt: receiptH2,
      receiptError: null,
      replacement: { originalHash: H1, replacementHash: H2, kind: "repriced" },
    });
    expect(r.isSuccess).toBe(true);
    expect(r.isCancelled).toBe(false);
    expect(r.replacementKind).toBe("repriced");
    expect(r.hash).toBe(H2);
    expect(r.receipt).toMatchObject({ transactionHash: H2, originalHash: H1, blockNumber: 105n, replaced: "repriced" });
    expect(r.receiptError).toBeNull();
  });

  it("cancelled replacement is never success: reports isCancelled and TransactionCancelledError", () => {
    const r = resolveWriteReceipt({
      sentHash: H1,
      receipt: receiptH2,
      receiptError: null,
      replacement: { originalHash: H1, replacementHash: H2, kind: "cancelled" },
    });
    expect(r.isSuccess).toBe(false);
    expect(r.isCancelled).toBe(true);
    expect(r.replacementKind).toBe("cancelled");
    expect(r.receipt).toBeUndefined();
    expect(r.receiptError).toBeInstanceOf(TransactionCancelledError);
    expect(isTransactionCancelledError(r.receiptError)).toBe(true);
  });

  it("changed-calldata replacement fails with TransactionReplacedError and drops the foreign receipt", () => {
    const r = resolveWriteReceipt({
      sentHash: H1,
      receipt: receiptH2,
      receiptError: null,
      replacement: { originalHash: H1, replacementHash: H2, kind: "replaced" },
    });
    expect(r.isSuccess).toBe(false);
    expect(r.isCancelled).toBe(false);
    expect(r.replacementKind).toBe("replaced");
    expect(r.receipt).toBeUndefined();
    expect(r.receiptError).toBeInstanceOf(TransactionReplacedError);
  });

  it("fail-closed: a mismatched receipt hash without a verified replacement record is treated as failure", () => {
    const r = resolveWriteReceipt({
      sentHash: H1,
      receipt: receiptH2,
      receiptError: null,
      replacement: null,
    });
    expect(r.isSuccess).toBe(false);
    expect(r.isCancelled).toBe(false);
    expect(r.receipt).toBeUndefined();
    expect(r.receiptError).toBeInstanceOf(TransactionReplacedError);
  });
});
