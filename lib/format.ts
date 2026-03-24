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

export function formatHealthFactor(hf: bigint): string {
  if (hf === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) return "∞";
  const num = Number(formatUnits(hf, 18));
  return num.toFixed(2);
}
