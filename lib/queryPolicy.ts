/**
 * Query-specific stale times and polling (FE-07). Positions, health factor, allowances and the
 * oracle prices behind them poll every 15 s, so a focused dashboard never shows a position older
 * than one poll plus one RPC round trip. Market-level data polls slower.
 */

export const POSITION_POLL_MS = 15_000;

export const QUERY = {
  /** Rarely changing config (pair limits, reserve config). */
  config: {
    staleTime: 60_000,
    refetchInterval: 60_000,
  },
  /** Reserve rates / totals. */
  market: {
    staleTime: 15_000,
    refetchInterval: 30_000,
  },
  /** On-chain oracle prices and the guard status. */
  prices: {
    staleTime: 10_000,
    refetchInterval: POSITION_POLL_MS,
  },
  /** Wallet balances, HF, allowances, positions. */
  user: {
    staleTime: 10_000,
    refetchInterval: POSITION_POLL_MS,
  },
} as const;

export type QueryPolicy = (typeof QUERY)[keyof typeof QUERY];

/** Data older than this (chain time) is shown as stale. */
export const STALE_AFTER_SECONDS = 45;

export function defaultQueryClientOptions() {
  return {
    queries: {
      staleTime: QUERY.user.staleTime,
      // No global interval: each read picks its policy above.
      refetchInterval: false as const,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  };
}
