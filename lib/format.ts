import { formatUnits, parseUnits, getAddress } from "viem";
import type Decimal from "decimal.js";
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

export function formatTokenAmount(value: bigint, decimals = 18, maxDecimals = 4): string {
  const num = Number(formatUnits(value, decimals));
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
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
 * An APY (a fraction, e.g. 0.0513) as a percent with two decimals, or "—" when unavailable.
 * Callers convert rates with `aprToApy` / `coreApy` from `lib/risk` first (ui-usability-v1 spec
 * §3.1): every cell labelled APY shows a compounded APY, never the raw APR. A non-zero value
 * smaller than 0.01% reads "<0.01%" instead of a misleading "0.00%".
 */
export function formatApy(apy: Decimal | undefined): string {
  if (apy === undefined || !apy.isFinite()) return "—";
  const pct = apy.mul(100);
  if (!pct.isZero() && pct.abs().lt(0.01)) return pct.isNegative() ? ">-0.01%" : "<0.01%";
  return `${pct.toFixed(2)}%`;
}

/**
 * A liquidation price (8 decimals) as text. Core prices are in USD (AaveOracle base currency);
 * isolated pair prices are in the pair's stable asset per ETH ("USDC").
 */
export function formatLiquidationPrice(price: LiquidationPrice, unit: "USD" | "USDC"): string {
  switch (price.kind) {
    case "none":
      return "None";
    case "now":
      return "Liquidatable now";
    case "unavailable":
      return "Unavailable";
    case "below":
    case "above": {
      const whole = price.price / 10n ** 8n;
      const cents = (price.price % 10n ** 8n) / 10n ** 6n;
      const amount = `${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
      return `ETH ${price.kind} ${unit === "USD" ? `$${amount}` : `${amount} USDC`}`;
    }
  }
}

/** A base-currency value (8 decimals, as `accountTotals()` returns) as USD, or "—" when unavailable. */
export function formatUsd8(value8: bigint | undefined): string {
  return formatUsd(value8 === undefined ? undefined : base8ToUsd(value8));
}
