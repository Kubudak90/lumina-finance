import { formatUnits, parseUnits, getAddress } from "viem";

export function formatUsd(value: bigint, decimals = 18): string {
  const num = Number(formatUnits(value, decimals));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: num < 1 ? 4 : 2,
  }).format(num);
}

/** Format a token amount (bigint, 18 decimals) to USD using a price multiplier */
export function formatTokenToUsd(value: bigint, price: number, decimals = 18): string {
  const num = Number(formatUnits(value, decimals)) * price;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: num < 1 ? 4 : 2,
  }).format(num);
}

export function formatPercent(rateBigInt: bigint): string {
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
  if (hf === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) return "∞";
  const num = Number(formatUnits(hf, 18));
  return num.toFixed(2);
}
