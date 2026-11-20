/**
 * LuminaPriceGuard.borrowStatus() → why borrows are (not) allowed (FE-07, spec §3.2). Mirrors the
 * `Status` enum in lumina-oracle contracts/lighter/LuminaPriceGuard.sol (order matters).
 */

export const GUARD_STATUS = [
  "OK",
  "PAUSED",
  "NO_MARKETS",
  "NO_REFERENCE",
  "REFERENCE_STALE",
  "CORE_PRICE_STALE",
  "CORE_READ_FAILED",
  "DEVIATION",
] as const;

export type GuardStatusKey = (typeof GUARD_STATUS)[number] | "UNKNOWN";

export interface GuardStatus {
  key: GuardStatusKey;
  marketId: number;
  borrowAllowed: boolean;
  message: string;
}

export interface GuardBounds {
  maxRefAgeSec: number;
  maxDeviationBps: number;
  maxCorePriceAgeSec: number;
}

/** Lighter Core market ids the guard watches (spec §3.1). */
const MARKET_NAMES: Record<number, string> = { 0: "ETH" };

function marketLabel(marketId: number): string {
  const name = MARKET_NAMES[marketId];
  return name ? `${name} (market ${marketId})` : `market ${marketId}`;
}

export function describeGuardStatus(code: number | undefined, marketId: number, bounds: GuardBounds): GuardStatus {
  const key: GuardStatusKey = code !== undefined && code >= 0 && code < GUARD_STATUS.length ? GUARD_STATUS[code] : "UNKNOWN";
  const m = marketLabel(marketId);
  const messages: Record<GuardStatusKey, string> = {
    OK: "Borrowing is open: the Lighter Core price and the keeper reference agree and are fresh.",
    PAUSED: "Borrowing is paused by the guardian (Safe).",
    NO_MARKETS: "The price guard has no markets configured; borrowing is blocked.",
    NO_REFERENCE: `No keeper reference price has been posted yet for ${m}; borrowing is blocked.`,
    REFERENCE_STALE: `The keeper reference price for ${m} is older than ${bounds.maxRefAgeSec}s; borrowing is blocked until the keeper posts again.`,
    CORE_PRICE_STALE: `The Lighter Core index price for ${m} has not changed for over ${bounds.maxCorePriceAgeSec}s; borrowing is blocked.`,
    CORE_READ_FAILED: `Reading the Lighter Core price for ${m} failed; borrowing is blocked.`,
    DEVIATION: `The Lighter Core price and the keeper reference for ${m} differ by more than ${bounds.maxDeviationBps / 100}%; borrowing is blocked.`,
    UNKNOWN: "Borrow status unavailable (price guard not readable).",
  };
  return { key, marketId, borrowAllowed: key === "OK", message: messages[key] };
}

/** What still works while the guard blocks borrows (spec §5.4). */
export const GUARD_BLOCKED_NOTE = {
  core: "Supply, repay, withdraw and liquidation still work.",
  isolated: "Borrowing and removing collateral while in debt are blocked; repay, add collateral, lending and liquidation still work.",
} as const;
