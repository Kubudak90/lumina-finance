/**
 * Replaced transaction classification and receipt resolution (N-FE-02 / F8).
 *
 * viem's `waitForTransactionReceipt` resolves with the replacement transaction's receipt whenever
 * the same (from, nonce) mines under another hash — whether the user sped up the same call
 * (`repriced`), cancelled it with a 0-value self-transfer (`cancelled`), or overwrote it with
 * different calldata (`replaced`). Only a verified same-call `repriced` replacement counts as
 * success; cancellations are surfaced as cancelled, and changed-calldata or unverified
 * replacements fail closed.
 */
import type { Hex } from "viem";
import type { ReceiptLogLike } from "./repayEvent";

export type ReplacementKind = "repriced" | "cancelled" | "replaced";

export class TransactionCancelledError extends Error {
  constructor() {
    super("Transaction was cancelled; nothing was done.");
    this.name = "TransactionCancelledError";
  }
}

export class TransactionReplacedError extends Error {
  constructor() {
    super("Transaction was replaced by a different call; nothing was done.");
    this.name = "TransactionReplacedError";
  }
}

export function isTransactionCancelledError(err: unknown): err is TransactionCancelledError {
  return (
    err instanceof TransactionCancelledError ||
    (typeof err === "object" && err !== null && (err as { name?: unknown }).name === "TransactionCancelledError")
  );
}

export interface ExpectedCall {
  to: `0x${string}`;
  value: bigint;
  data: Hex;
}

export interface ReplacementTxLike {
  hash: `0x${string}`;
  from?: `0x${string}` | null;
  to?: `0x${string}` | null;
  value?: bigint | null;
  input?: Hex | null;
}

export interface ReplacementEventLike {
  reason: "repriced" | "cancelled" | "replaced";
  replacedTransaction: ReplacementTxLike;
  transaction: ReplacementTxLike;
}

export interface VerifiedReplacement {
  originalHash: `0x${string}`;
  replacementHash: `0x${string}`;
  kind: ReplacementKind;
}

export interface RawReceiptLike {
  transactionHash: `0x${string}`;
  status: "success" | "reverted";
  blockNumber: bigint;
  logs?: readonly ReceiptLogLike[];
}

export interface VerifiedReceipt {
  transactionHash: `0x${string}`;
  /** Hash originally broadcast before any verified repricing replacement. */
  originalHash: `0x${string}`;
  status: "success" | "reverted";
  blockNumber: bigint;
  logs?: readonly ReceiptLogLike[];
  /** Present and equal to `"repriced"` when this receipt came from a verified same-call replacement. */
  replaced?: "repriced";
}

export interface ResolvedWriteReceipt {
  isSuccess: boolean;
  isCancelled: boolean;
  replacementKind: ReplacementKind | null;
  /** Effective hash: the verified replacement hash when repriced, otherwise the sent hash. */
  hash: `0x${string}` | undefined;
  /** Verified receipt (original or same-call repriced); undefined on cancellation or foreign replacement. */
  receipt: VerifiedReceipt | undefined;
  /** Failure or cancellation error (`receiptError`, `TransactionCancelledError`, or `TransactionReplacedError`). */
  receiptError: Error | null;
}

const sameHex = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Classifies a viem `onReplaced` event, independently checking target, value and calldata against
 * the original transaction (and against `expectedCall` when available).
 */
export function classifyReplacement(
  event: ReplacementEventLike,
  expectedCall?: ExpectedCall,
): VerifiedReplacement {
  const orig = event.replacedTransaction;
  const next = event.transaction;

  const sameTo = sameHex(next.to, orig.to) && (!expectedCall || sameHex(next.to, expectedCall.to));
  const sameValue =
    (next.value ?? 0n) === (orig.value ?? 0n) && (!expectedCall || (next.value ?? 0n) === expectedCall.value);
  const sameInput =
    sameHex(next.input, orig.input) && (!expectedCall || sameHex(next.input, expectedCall.data));

  if (event.reason === "repriced" && sameTo && sameValue && sameInput) {
    return { originalHash: orig.hash, replacementHash: next.hash, kind: "repriced" };
  }

  const isSelfCancel =
    event.reason === "cancelled" &&
    (next.from === undefined || next.from === null || sameHex(next.from, next.to)) &&
    (next.value ?? 0n) === 0n &&
    (!next.input || next.input === "0x");

  if (isSelfCancel) {
    return { originalHash: orig.hash, replacementHash: next.hash, kind: "cancelled" };
  }

  return { originalHash: orig.hash, replacementHash: next.hash, kind: "replaced" };
}

/**
 * Resolves a transaction receipt against the originally broadcast hash and any verified
 * replacement event. Fails closed when a receipt hash differs from `sentHash` without a verified
 * same-call `"repriced"` replacement.
 */
export function resolveWriteReceipt(params: {
  sentHash: `0x${string}` | undefined;
  receipt: RawReceiptLike | undefined;
  receiptError: Error | null;
  replacement: VerifiedReplacement | null;
}): ResolvedWriteReceipt {
  const { sentHash, receipt, receiptError, replacement } = params;
  if (!sentHash) {
    return { isSuccess: false, isCancelled: false, replacementKind: null, hash: undefined, receipt: undefined, receiptError: null };
  }
  if (receiptError) {
    return { isSuccess: false, isCancelled: false, replacementKind: null, hash: sentHash, receipt: undefined, receiptError };
  }
  if (!receipt) {
    return { isSuccess: false, isCancelled: false, replacementKind: null, hash: sentHash, receipt: undefined, receiptError: null };
  }

  if (sameHex(receipt.transactionHash, sentHash)) {
    const ok = receipt.status === "success";
    return {
      isSuccess: ok,
      isCancelled: false,
      replacementKind: null,
      hash: receipt.transactionHash,
      receipt: { ...receipt, originalHash: sentHash },
      receiptError: ok ? null : new Error("Transaction reverted"),
    };
  }

  const matchesReplacement =
    replacement !== null &&
    sameHex(replacement.originalHash, sentHash) &&
    sameHex(replacement.replacementHash, receipt.transactionHash);

  if (matchesReplacement && replacement.kind === "repriced") {
    const ok = receipt.status === "success";
    return {
      isSuccess: ok,
      isCancelled: false,
      replacementKind: "repriced",
      hash: receipt.transactionHash,
      receipt: { ...receipt, originalHash: sentHash, replaced: "repriced" },
      receiptError: ok ? null : new Error("Transaction reverted"),
    };
  }

  if (matchesReplacement && replacement.kind === "cancelled") {
    return {
      isSuccess: false,
      isCancelled: true,
      replacementKind: "cancelled",
      hash: sentHash,
      receipt: undefined,
      receiptError: new TransactionCancelledError(),
    };
  }

  return {
    isSuccess: false,
    isCancelled: false,
    replacementKind: "replaced",
    hash: sentHash,
    receipt: undefined,
    receiptError: new TransactionReplacedError(),
  };
}
