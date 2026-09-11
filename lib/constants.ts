import baseSepolia from "../deployments/base-sepolia.json";
import { checksumAddress } from "./format";

export interface MarketConfig {
  asset: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  aToken: `0x${string}`;
  variableDebtToken: `0x${string}`;
  icon: string; // path to icon
}

const MARKET_ICONS: Record<string, string> = {
  USDC: "/tokens/usdc.svg",
  LIT: "/tokens/lit.webp",
  WETH: "/tokens/eth.svg",
};

export const MARKETS: MarketConfig[] = baseSepolia.markets.map((market) => ({
  asset: checksumAddress(market.asset),
  symbol: market.symbol,
  name: market.name,
  decimals: market.decimals,
  aToken: checksumAddress(market.aToken),
  variableDebtToken: checksumAddress(market.variableDebtToken),
  icon: MARKET_ICONS[market.symbol] ?? "/tokens/eth.svg",
}));

export function getMarketByAsset(asset: string): MarketConfig | undefined {
  return MARKETS.find((m) => m.asset.toLowerCase() === asset.toLowerCase());
}

export function getMarketBySymbol(symbol: string): MarketConfig | undefined {
  return MARKETS.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
}

/** RAY = 1e27, used for Aave V3 rate values */
export const RAY = 10n ** 27n;

/** WAD = 1e18, used for health factor and other 18-decimal values */
export const WAD = 10n ** 18n;

/** Convert a RAY-based rate (1e27) to an annualized percentage number */
export function rayToPercent(ray: bigint): number {
  // ray is annual rate in 1e27 format; divide by 1e25 to get percent
  return Number(ray) / 1e25;
}
