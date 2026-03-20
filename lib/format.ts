import { formatUnits } from "viem";

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
  // Rate is in 1e18 format (e.g., 4e16 = 4%)
  const pct = Number(formatUnits(rateBigInt, 16));
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

export function formatHealthFactor(hf: bigint): string {
  if (hf === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) return "∞";
  const num = Number(formatUnits(hf, 18));
  return num.toFixed(2);
}
