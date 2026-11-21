/**
 * Display strings for the transaction flow (ui-usability-v1 §3.2). Token amounts, APYs and
 * liquidation prices are NOT formatted here: they delegate to the one formatter of each in
 * `lib/format`, which the pages use too, so a modal never shows a different current value than
 * the page it was opened from (U4 review r1 #1, #2, #6). "unavailable" is never rendered as 0
 * (FE-07).
 */
import type Decimal from "decimal.js";
import { WAD, type BorrowLimitUsed } from "@/lib/risk";
import { formatApy, formatTokenAmount } from "@/lib/format";

export const UNAVAILABLE = "unavailable";

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A token amount (base units): `lib/format` `formatTokenAmount` (4 places, rounded down, "<0.0001"). */
export function formatAmount(value: bigint, decimals: number): string {
  return formatTokenAmount(value, decimals);
}

/** Amount with its symbol, or "unavailable". */
export function formatToken(value: bigint | undefined, decimals: number, symbol: string): string {
  return value === undefined ? UNAVAILABLE : `${formatTokenAmount(value, decimals)} ${symbol}`.trim();
}

/** An APY (Decimal fraction): `lib/format` `formatApy`, with the modals' "unavailable". */
export function formatRate(rate: Decimal | undefined): string {
  return formatApy(rate, UNAVAILABLE);
}

/** Borrow limit used: "42.10%", "over 100%" with debt and no capacity. */
export function formatBorrowLimit(used: BorrowLimitUsed): string {
  if (used.kind === "over") return "over 100%";
  // WAD = 100%; floor to hundredths of a percent.
  const hundredths = (used.wad * 10_000n) / WAD;
  return `${groupThousands((hundredths / 100n).toString())}.${(hundredths % 100n).toString().padStart(2, "0")}%`;
}
