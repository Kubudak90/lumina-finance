/**
 * USD values from on-chain oracle prices only (FE-06). Prices are keyed by lowercase asset
 * address. Core prices are AaveOracle.getAssetPrice (base currency, 8 decimals). Isolated
 * collateral is valued in asset units through the pair oracle's exchange rate, then priced like
 * the asset.
 */
import { collateralInAsset } from "./borrowMax";

export const BASE_CURRENCY_DECIMALS = 8;
const BASE_UNIT = 10n ** BigInt(BASE_CURRENCY_DECIMALS);

export type PriceMap = ReadonlyMap<string, bigint>;

export function priceKey(asset: string): string {
  return asset.toLowerCase();
}

/** Value of `amount` (token base units) in base currency units (8 decimals), floored. */
export function baseValue(amount: bigint, decimals: number, price8: bigint): bigint {
  return (amount * price8) / 10n ** BigInt(decimals);
}

/** USD number for display, or undefined when the oracle price is unavailable. */
export function usdValue(amount: bigint, decimals: number, price8: bigint | undefined): number | undefined {
  if (amount === 0n) return 0;
  if (price8 === undefined || price8 <= 0n) return undefined;
  const value = baseValue(amount, decimals, price8);
  return Number(value / BASE_UNIT) + Number(value % BASE_UNIT) / Number(BASE_UNIT);
}

/** Collateral of an isolated position in USD: collateral → asset via exchange rate → USD. */
export function isolatedCollateralUsd(
  collateral: bigint,
  exchangeRate: bigint | undefined,
  assetDecimals: number,
  assetPrice8: bigint | undefined,
): number | undefined {
  if (collateral === 0n) return 0;
  if (exchangeRate === undefined || exchangeRate <= 0n) return undefined;
  return usdValue(collateralInAsset(collateral, exchangeRate), assetDecimals, assetPrice8);
}

export function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2,
  }).format(value);
}

/** Sum of USD values; undefined if any needed price is missing (never silently $0). */
export function sumUsd(values: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  for (const v of values) {
    if (v === undefined) return undefined;
    total += v;
  }
  return total;
}
