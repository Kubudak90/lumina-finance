/**
 * Display strings for the transaction flow (ui-usability-v1 §3.2). Amounts are converted with
 * decimal.js from bigint, never through a float; "unavailable" is never rendered as 0 (FE-07).
 */
import type Decimal from "decimal.js";
import { PRICE_DECIMALS, WAD, toDecimal, type BorrowLimitUsed, type LiquidationPrice } from "@/lib/risk";

export const UNAVAILABLE = "unavailable";

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A token amount (base units) as "1,234.5678", rounded down to `maxFraction` places; a non-zero
 * amount below the last place reads "<0.0001" (dust never shows as 0).
 */
export function formatAmount(value: bigint, decimals: number, maxFraction = 4): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const d = toDecimal(abs.toString()).div(toDecimal(10).pow(decimals));
  const rounded = d.toDecimalPlaces(maxFraction, 1 /* ROUND_DOWN */);
  if (abs > 0n && rounded.isZero()) return `${negative ? "-" : ""}<${toDecimal(1).div(toDecimal(10).pow(maxFraction)).toFixed()}`;
  const [int, frac] = rounded.toFixed().split(".");
  return `${negative ? "-" : ""}${groupThousands(int)}${frac ? `.${frac}` : ""}`;
}

/** Amount with its symbol, or "unavailable". */
export function formatToken(value: bigint | undefined, decimals: number, symbol: string, maxFraction = 4): string {
  return value === undefined ? UNAVAILABLE : `${formatAmount(value, decimals, maxFraction)} ${symbol}`.trim();
}

/** A fraction (Decimal, e.g. 0.0512) as "5.12%", or "unavailable". */
export function formatRate(rate: Decimal | undefined): string {
  if (rate === undefined) return UNAVAILABLE;
  return `${rate.times(100).toDecimalPlaces(2, 1).toFixed(2)}%`;
}

/** Borrow limit used: "42.10%", "over 100%" with debt and no capacity. */
export function formatBorrowLimit(used: BorrowLimitUsed): string {
  if (used.kind === "over") return "over 100%";
  // WAD = 100%; floor to hundredths of a percent.
  const hundredths = (used.wad * 10_000n) / WAD;
  return `${groupThousands((hundredths / 100n).toString())}.${(hundredths % 100n).toString().padStart(2, "0")}%`;
}

/** An 8-decimal ETH price: "$2,000.00" for the core (USD) or "2,000.00 USDC" for a pair. */
export function formatEthPrice(price: bigint, unit: "usd" | "usdc"): string {
  const abs = price < 0n ? -price : price;
  const fixed = toDecimal(abs.toString()).div(toDecimal(10).pow(PRICE_DECIMALS)).toDecimalPlaces(2, 1 /* ROUND_DOWN */).toFixed(2);
  const [int, frac] = fixed.split(".");
  const text = `${price < 0n ? "-" : ""}${groupThousands(int)}.${frac}`;
  return unit === "usd" ? `$${text}` : `${text} USDC`;
}

/** Liquidation price of ETH (spec §3.1): "ETH below $1,234.56", "now", "none" or "unavailable". */
export function formatLiquidationPrice(p: LiquidationPrice | undefined, unit: "usd" | "usdc"): string {
  if (!p) return UNAVAILABLE;
  switch (p.kind) {
    case "none":
      return "none";
    case "now":
      return "now (at any ETH price)";
    case "below":
      return `ETH below ${formatEthPrice(p.price, unit)}`;
    case "above":
      return `ETH above ${formatEthPrice(p.price, unit)}`;
    case "unavailable":
      return UNAVAILABLE;
  }
}
