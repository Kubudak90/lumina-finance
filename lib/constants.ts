import { ADDRESSES } from "./contracts";

export interface MarketConfig {
  asset: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  aToken: `0x${string}`;
  variableDebtToken: `0x${string}`;
  icon: string; // path to icon
}

export const MARKETS: MarketConfig[] = [
  {
    asset: ADDRESSES.usdc,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6, // Note: USDC uses 6 decimals in Aave V3
    aToken: "0x99Dcf52AbEbAf469d56A212A52fC45e29C2b718A" as `0x${string}`,
    variableDebtToken: "0xBD00FD0340461082CAc240cAa5AEbae62bb55cA1" as `0x${string}`,
    icon: "/tokens/usdc.svg",
  },
  {
    asset: ADDRESSES.weth,
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    aToken: "0x1Ae2e9828Ba36110A530082e3F5BC46EBa451A4e" as `0x${string}`,
    variableDebtToken: "0xC9527124adfBA28dB02930A23b2e0EB918E8160a" as `0x${string}`,
    icon: "/tokens/eth.svg",
  },
];

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
