import { ADDRESSES } from "./contracts";

export interface MarketConfig {
  asset: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  adapter: `0x${string}`;
  icon: string; // path to icon
}

export const MARKETS: MarketConfig[] = [
  {
    asset: ADDRESSES.usdc,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 18,
    adapter: ADDRESSES.usdcAdapter,
    icon: "/tokens/usdc.svg",
  },
  {
    asset: ADDRESSES.weth,
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    adapter: ADDRESSES.ethAdapter,
    icon: "/tokens/eth.svg",
  },
];

export function getMarketByAsset(asset: string): MarketConfig | undefined {
  return MARKETS.find((m) => m.asset.toLowerCase() === asset.toLowerCase());
}

export function getMarketBySymbol(symbol: string): MarketConfig | undefined {
  return MARKETS.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
}
