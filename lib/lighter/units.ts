/**
 * Display vs wire ("real") units — same formulas as `lighter-ts` `utils/multiplier.ts`.
 *
 *   display_size  = real_size  × multiplier
 *   display_price = real_price ÷ multiplier
 *
 * Implemented locally with decimal.js so the public barrel does not import the SDK.
 */

import Decimal from "decimal.js";

export type SizeMarketParams = {
  multiplier: string;
  display_size_decimals: number;
};

export type PriceMarketParams = {
  multiplier: string;
  display_price_decimals: number;
};

export type RealSizeMarketParams = {
  multiplier: string;
  size_decimals: number;
};

export type RealPriceMarketParams = {
  multiplier: string;
  price_decimals: number;
  display_price_decimals: number;
};

const multiplierPrecisionLookup: Record<string, number> = {};

function getMultiplierPrecision(multiplier: string): number {
  if (multiplierPrecisionLookup[multiplier] !== undefined) {
    return multiplierPrecisionLookup[multiplier];
  }
  const precision = multiplier.includes(".")
    ? (multiplier.replace(/0+$/, "").split(".")[1]?.length ?? 0)
    : 0;
  multiplierPrecisionLookup[multiplier] = precision;
  return precision;
}

function ceilNumber(num: number, decimal: number): number {
  return new Decimal(num).toDecimalPlaces(decimal, Decimal.ROUND_CEIL).toNumber();
}

function floorNumber(num: number, decimal: number): number {
  return new Decimal(num).toDecimalPlaces(decimal, Decimal.ROUND_FLOOR).toNumber();
}

export function realSizeToDisplay(realSize: number | string, params: SizeMarketParams): number {
  if (Number(realSize) === 0) return 0;
  const multiplier = params.multiplier;
  const multiplierPrecision = getMultiplierPrecision(multiplier);
  return ceilNumber(
    Number(realSize) * Number(multiplier) - 0.1 * 10 ** -(params.display_size_decimals + multiplierPrecision),
    params.display_size_decimals
  );
}

export function realPriceToDisplay(realPrice: number | string, params: PriceMarketParams): number {
  if (Number(realPrice) === 0) return 0;
  const multiplier = params.multiplier;
  const multiplierPrecision = getMultiplierPrecision(multiplier);
  return ceilNumber(
    Number(realPrice) / Number(multiplier) - 0.1 * 10 ** -(params.display_price_decimals + multiplierPrecision),
    params.display_price_decimals
  );
}

export function displaySizeToReal(displaySize: number | string, params: RealSizeMarketParams): number {
  if (Number(displaySize) === 0) return 0;
  const multiplier = params.multiplier;
  const multiplierPrecision = getMultiplierPrecision(multiplier);
  return floorNumber(
    Number(displaySize) / Number(multiplier) + 0.1 * 10 ** -(params.size_decimals + multiplierPrecision),
    params.size_decimals
  );
}

export function displayPriceToReal(
  displayPrice: number | string,
  params: RealPriceMarketParams,
  isShort: boolean
): number {
  const multiplier = params.multiplier;
  const multiplierPrecision = getMultiplierPrecision(multiplier);
  const ans = floorNumber(
    Number(displayPrice) * Number(multiplier) +
      0.1 * 10 ** -(params.display_price_decimals + multiplierPrecision),
    params.price_decimals
  );
  if (!isShort) return ans;
  const isValid = realPriceToDisplay(ans, params) === Number(displayPrice);
  if (isValid) return ans;
  return floorNumber(ans + 1.1 * 10 ** -params.price_decimals, params.price_decimals);
}

export function getDisplayDecimals(market: {
  price_decimals: number;
  size_decimals: number;
  multiplier: string;
}): { display_price_decimals: number; display_size_decimals: number } {
  const multiplier = Number(market.multiplier);
  return {
    display_price_decimals: market.price_decimals + (multiplier > 1 ? 1 : 0),
    display_size_decimals: market.size_decimals + (multiplier < 1 ? 1 : 0),
  };
}
