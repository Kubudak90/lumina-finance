/**
 * USD values from on-chain oracle prices only (FE-06). Prices are keyed by lowercase asset
 * address. Core prices are AaveOracle.getAssetPrice (base currency, 8 decimals). Isolated
 * collateral is valued in asset units through the pair oracle's exchange rate, then priced like
 * the asset.
 */
import { EXCHANGE_PRECISION } from "./borrowMax";

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

/** Base-currency (1e8) value → USD number for display. */
export function base8ToUsd(value8: bigint): number {
  return Number(value8 / BASE_UNIT) + Number(value8 % BASE_UNIT) / Number(BASE_UNIT);
}

/**
 * USD number for display, or undefined when the amount or the oracle price is unavailable (a
 * failed read is never valued as zero).
 */
export function usdValue(amount: bigint | undefined, decimals: number, price8: bigint | undefined): number | undefined {
  if (amount === undefined) return undefined;
  if (amount === 0n) return 0;
  if (price8 === undefined || price8 <= 0n) return undefined;
  return base8ToUsd(baseValue(amount, decimals, price8));
}

/**
 * Isolated collateral in base currency (1e8): collateral → asset units through the pair oracle's
 * exchange rate (collateral per asset × 1e18) → USD at the asset's AaveOracle price, in ONE
 * division so nothing rounds before the USD scale:
 *   value8 = collateral × 1e18 × assetPrice8 / (rate × 10^assetDecimals)
 */
export function isolatedCollateralBase8(
  collateral: bigint,
  exchangeRate: bigint,
  assetDecimals: number,
  assetPrice8: bigint,
): bigint {
  return (collateral * EXCHANGE_PRECISION * assetPrice8) / (exchangeRate * 10n ** BigInt(assetDecimals));
}

export function isolatedCollateralUsd(
  collateral: bigint | undefined,
  exchangeRate: bigint | undefined,
  assetDecimals: number,
  assetPrice8: bigint | undefined,
): number | undefined {
  if (collateral === undefined) return undefined;
  if (collateral === 0n) return 0;
  if (exchangeRate === undefined || exchangeRate <= 0n || assetPrice8 === undefined || assetPrice8 <= 0n) return undefined;
  return base8ToUsd(isolatedCollateralBase8(collateral, exchangeRate, assetDecimals, assetPrice8));
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

/**
 * Raw collateral units one WHOLE asset unit is worth at a pair's rate (collateral per asset ×
 * 1e18, oriented as that pair uses it). For display: "1 ASSET = x COLLATERAL".
 */
export function collateralPerWholeAsset(exchangeRate: bigint, assetDecimals: number): bigint {
  return (exchangeRate * 10n ** BigInt(assetDecimals)) / EXCHANGE_PRECISION;
}
