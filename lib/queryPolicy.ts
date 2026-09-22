/** Query-specific stale times. Do not poll every wagmi read on a 15s global timer. */

export const QUERY = {
  /** Rarely changing config (whitelist, pool flags, e-mode categories). */
  config: {
    staleTime: 60_000,
    refetchInterval: 60_000,
  },
  /** Reserve rates / totals. */
  market: {
    staleTime: 30_000,
    refetchInterval: 60_000,
  },
  /** Oracle / display prices. */
  prices: {
    staleTime: 20_000,
    refetchInterval: 30_000,
  },
  /**
   * Wallet balances, HF, allowances, positions.
   * No interval — refreshed on window focus and after a confirmed write.
   */
  user: {
    staleTime: 12_000,
    refetchInterval: false as const,
  },
} as const;

export type QueryPolicy = (typeof QUERY)[keyof typeof QUERY];

export function defaultQueryClientOptions() {
  return {
    queries: {
      staleTime: QUERY.user.staleTime,
      refetchInterval: false as const,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  };
}
