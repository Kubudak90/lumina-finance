import { LUMINA, getCoreMarketByAsset, getCoreMarketBySymbol, type CoreMarket } from "./deployments";

/** A core (Aave) market, from the manifest of the Lumina chain. */
export type MarketConfig = CoreMarket;

export const MARKETS: readonly MarketConfig[] = LUMINA.coreMarkets;

export function getMarketByAsset(asset: string): MarketConfig | undefined {
  return getCoreMarketByAsset(asset);
}

export function getMarketBySymbol(symbol: string): MarketConfig | undefined {
  return getCoreMarketBySymbol(symbol);
}

/** RAY = 1e27, used for Aave V3 rate values */
export const RAY = 10n ** 27n;

/** WAD = 1e18, used for health factor and other 18-decimal values */
export const WAD = 10n ** 18n;

/** Convert a RAY-based rate (1e27) to an annualized percentage number */
export function rayToPercent(ray: bigint): number {
  return Number(ray) / 1e25;
}
