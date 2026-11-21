import type { LighterAccountExistence } from "./types";

/**
 * Account state of the READ-ONLY Lighter view (Codex r1 #13). The view never reads the stored
 * signing seed, so it cannot tell whether stored keys match; an account that exists is shown as
 * "ReadOnly" (public data only, authenticated data unavailable) — never as "KeysDontMatch".
 */
export type ReadOnlyAccountExistence = Extract<LighterAccountExistence, "NoWallet" | "Deciding" | "ShouldDeposit"> | "ReadOnly";

export function readOnlyAccountExistence(input: {
  l1Initialized: boolean;
  userAddress: string | null | undefined;
  accountIndex: number;
  accountsPending: boolean;
  accountsSuccess: boolean;
  accountsErrorStatus: number | undefined | null;
  accountsError: boolean;
}): ReadOnlyAccountExistence {
  if (!input.l1Initialized) return "Deciding";
  if (!input.userAddress) return "NoWallet";
  if (input.accountsPending) return "Deciding";
  if ((!input.accountIndex && input.accountsSuccess) || (input.accountsError && input.accountsErrorStatus !== 400)) {
    return "Deciding";
  }
  if (!input.accountIndex) return "ShouldDeposit";
  return "ReadOnly";
}

export const READ_ONLY_NOTE = "Authenticated data unavailable in read-only mode.";
