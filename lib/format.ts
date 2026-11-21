import { formatUnits, parseUnits, getAddress } from "viem";
import Decimal from "decimal.js";
import type { LiquidationPrice } from "./risk";
import { base8ToUsd, formatUsd } from "./prices";

/** Aave returns type(uint256).max as the health factor of an account without debt. */
export const MAX_HEALTH_FACTOR = (1n << 256n) - 1n;

/**
 * An Aave ray rate as a plain percent: this is the APR. A cell labelled "APY" uses
 * `formatApy(coreApy(rate))` instead (ui-usability-v1 spec §3.1).
 */
export function formatPercent(rateBigInt: bigint | undefined): string {
  if (rateBigInt === undefined) return "—";
  // Aave V3 rates are in RAY format (1e27). Divide by 1e25 to get a percentage.
  // e.g., 4e25 = 4%
  const pct = Number(rateBigInt) / 1e25;
  return `${pct.toFixed(2)}%`;
}

// ---------------------------------------------------------------------------------------------
// Token amounts: ONE formatter for every surface (ui-usability-v1 U4 review r1 #2)
// ---------------------------------------------------------------------------------------------

/**
 * decimal.js with room for any uint256 (78 digits): base units / 10^decimals is exact, so the only
 * rounding is the one `formatTokenAmount` asks for. Never a float (spec §4).
 */
const AmountDecimal = Decimal.clone({ precision: 100 });

/** Fraction digits of every token amount on screen; a smaller non-zero amount reads "<0.0001". */
export const AMOUNT_FRACTION_DIGITS = 4;

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `value` base units as a decimal string, cut to `places` fraction digits (toward zero). */
function unitsDown(value: bigint, decimals: number, places: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const d = new AmountDecimal(abs.toString()).div(new AmountDecimal(10).pow(decimals));
  const cut = d.toDecimalPlaces(places, Decimal.ROUND_DOWN);
  // Dust floor: a non-zero amount below the last place never reads 0.
  if (abs > 0n && cut.isZero()) return `${negative ? ">-" : "<"}${new AmountDecimal(10).pow(-places).toFixed()}`;
  const [int, frac] = cut.toFixed().split(".");
  return `${negative ? "-" : ""}${groupThousands(int)}${frac ? `.${frac}` : ""}`;
}

/**
 * A token amount (base units) as "1,234.5678": the one formatter of every token amount the app
 * shows — positions, balances, debts, collateral, wallet, allowances, limits and totals, on the
 * pages and in the modals — so one amount never reads two ways.
 *
 * The convention (U4 review r1 #2), one rule everywhere:
 * - at most 4 fraction digits (trailing zeros dropped), thousands grouped;
 * - ROUNDED DOWN (truncated), for every kind of amount, debts included;
 * - a non-zero amount below 0.0001 reads "<0.0001", never "0".
 * Why one mode, and down: a balance, a withdrawable amount or a MAX is never shown larger than it
 * is; and a truncation is a prefix of the exact value the user also sees (the input after MAX,
 * the raw call in Details, the wallet prompt), so two renderings of one amount never contradict
 * each other. A debt is understated by less than 0.0001 of the token at most and never reads 0;
 * the risk figures carry the conservative rounding (HF floored, LTV rounded up, lib/risk).
 */
export function formatTokenAmount(value: bigint, decimals: number): string {
  return unitsDown(value, decimals, AMOUNT_FRACTION_DIGITS);
}

/**
 * A pair's oracle price (collateral per one asset, in collateral base units) with 6 fraction
 * digits, rounded down: "1 USDC = 0.000426 WETH" keeps its significant digits. A price, not an
 * amount, so it does not follow the 4-digit amount rule.
 */
export function formatPairPrice(value: bigint, decimals: number): string {
  return unitsDown(value, decimals, 6);
}

export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Validate that a decimal string doesn't exceed the given decimal places */
export function isValidDecimalInput(value: string, maxDecimals: number): boolean {
  if (!value || value === "") return true;
  if (!/^\d*\.?\d*$/.test(value)) return false;
  const parts = value.split(".");
  if (parts.length === 2 && parts[1].length > maxDecimals) return false;
  return true;
}

/** Safely parse a decimal string to bigint, returning null on invalid input */
export function safeParseUnits(value: string, decimals: number): bigint | null {
  if (!value || value === "" || !isValidDecimalInput(value, decimals)) return null;
  try {
    return parseUnits(value, decimals);
  } catch {
    return null;
  }
}

/** Safely convert an unknown value to bigint with a fallback */
export function safeBigInt(value: unknown, fallback: bigint = 0n): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  return fallback;
}

/** Validate and checksum an address at load time */
export function checksumAddress(address: string): `0x${string}` {
  return getAddress(address) as `0x${string}`;
}

export function formatHealthFactor(hf: bigint): string {
  if (hf === MAX_HEALTH_FACTOR) return "∞";
  const num = Number(formatUnits(hf, 18));
  return num.toFixed(2);
}

/**
 * An APY (a fraction, e.g. 0.0513) as a percent with two decimals: the ONE APY formatter, used by
 * every page and (through `components/tx/format` `formatRate`) every modal, so the same APY reads
 * the same everywhere (U4 review r1 #1). Callers convert rates with `aprToApy` / `coreApy` from
 * `lib/risk` first (spec §3.1): every cell labelled APY shows a compounded APY, never the raw APR.
 * - Rounded half-up to hundredths of a percent (5.1271% → "5.13%"), whatever Decimal configuration
 *   the value was built with. An APY is a rate estimate with no side to be conservative on (a net
 *   APY can be either sign), so it takes the nearest value.
 * - A non-zero value smaller than 0.01% reads "<0.01%" (">-0.01%" below zero), never "0.00%".
 * - Undefined or non-finite is unavailable: `unavailable` ("—" on the pages; the modals pass their
 *   "unavailable").
 */
export function formatApy(apy: Decimal | undefined, unavailable = "—"): string {
  if (apy === undefined || !apy.isFinite()) return unavailable;
  const pct = apy.mul(100);
  if (!pct.isZero() && pct.abs().lt(0.01)) return pct.isNegative() ? ">-0.01%" : "<0.01%";
  return `${pct.toFixed(2, Decimal.ROUND_HALF_UP)}%`;
}

/** An 8-decimal ETH price, floored to cents: "$2,000.00" (core, USD) or "2,000.00 USDC" (a pair). */
export function formatEthPrice(price8: bigint, unit: "USD" | "USDC"): string {
  const negative = price8 < 0n;
  const abs = negative ? -price8 : price8;
  const cents = abs / 10n ** 6n;
  const text = `${negative ? "-" : ""}${groupThousands((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, "0")}`;
  return unit === "USD" ? `$${text}` : `${text} USDC`;
}

/**
 * A liquidation price as text: the ONE wording on the risk card, the positions table and the
 * transaction summaries (U4 review r1 #6). Core prices are in USD (AaveOracle base currency);
 * isolated pair prices are in the pair's stable asset per ETH ("USDC").
 * "ETH below $1,234.56" / "ETH above 7,800.00 USDC" (floored to cents), "now (at any ETH price)",
 * "none", or "unavailable" (also for a missing input: FE-07, never 0).
 */
export function formatLiquidationPrice(price: LiquidationPrice | undefined, unit: "USD" | "USDC"): string {
  if (!price) return "unavailable";
  switch (price.kind) {
    case "none":
      return "none";
    case "now":
      return "now (at any ETH price)";
    case "unavailable":
      return "unavailable";
    case "below":
    case "above":
      return `ETH ${price.kind} ${formatEthPrice(price.price, unit)}`;
  }
}

/** A base-currency value (8 decimals, as `accountTotals()` returns) as USD, or "—" when unavailable. */
export function formatUsd8(value8: bigint | undefined): string {
  return formatUsd(value8 === undefined ? undefined : base8ToUsd(value8));
}
