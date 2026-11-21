import type { IsolatedMarketSides } from "@/lib/risk";

/** Which side of a pair is which (for the liquidation-price direction); undefined until the pair loads. */
export function isolatedSides(
  info: { assetSymbol: string; collateralSymbol: string; assetDecimals: number; collateralDecimals: number } | undefined,
): IsolatedMarketSides | undefined {
  if (!info) return undefined;
  return {
    assetSymbol: info.assetSymbol,
    collateralSymbol: info.collateralSymbol,
    assetDecimals: info.assetDecimals,
    collateralDecimals: info.collateralDecimals,
  };
}
