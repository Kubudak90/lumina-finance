/**
 * Reserve status for the market table, from on-chain reads only. Any read the status depends on
 * that failed or is loading gives "Unknown" — a paused reserve must never show as "Active" because
 * `getPaused` failed (Gemini r2 m3).
 */
export type MarketStatus = "Unknown" | "Paused" | "Frozen" | "Active" | "Inactive";

export function marketStatus(m: {
  loaded: boolean;
  paused: boolean | undefined;
  config: { isActive: boolean; isFrozen: boolean } | undefined;
}): MarketStatus {
  if (!m.loaded || m.paused === undefined || m.config === undefined) return "Unknown";
  if (m.paused) return "Paused";
  if (m.config.isFrozen) return "Frozen";
  return m.config.isActive ? "Active" : "Inactive";
}
