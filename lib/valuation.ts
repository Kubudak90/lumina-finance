/**
 * Position valuation from on-chain reads (FE-06, Codex r1 #9/#10). A missing input — a failed
 * read, a missing oracle price or exchange rate, an incomplete position list — makes the affected
 * total `undefined` ("unavailable"), never a silently lower number. Valuations carry the OLDEST
 * block among the reads they combine.
 */
import { isolatedCollateralUsd, sumUsd, usdValue } from "./prices";

export interface BlockStamp {
  number: bigint;
  timestamp: bigint;
}

/** Oldest of the stamps (by block), or undefined if any input has no stamp yet. */
export function oldestStamp(stamps: readonly (BlockStamp | undefined)[]): BlockStamp | undefined {
  let oldest: BlockStamp | undefined;
  for (const s of stamps) {
    if (!s) return undefined;
    if (!oldest || s.number < oldest.number) oldest = s;
  }
  return oldest;
}

type PriceOf = (asset: string) => bigint | undefined;

export interface CorePositionLike {
  asset: string;
  decimals: number;
  supplied: bigint | undefined;
  borrowed: bigint | undefined;
  collateral: bigint | undefined;
}

export function coreLegsUsd(positions: readonly CorePositionLike[], priceOf: PriceOf) {
  return {
    supplied: sumUsd(positions.map((p) => usdValue(p.supplied, p.decimals, priceOf(p.asset)))),
    borrowed: sumUsd(positions.map((p) => usdValue(p.borrowed, p.decimals, priceOf(p.asset)))),
    collateral: sumUsd(positions.map((p) => usdValue(p.collateral, p.decimals, priceOf(p.asset)))),
  };
}

export interface IsolatedPositionLike {
  asset: string;
  assetDecimals: number;
  suppliedAssets: bigint | undefined;
  borrowedAssets: bigint | undefined;
  collateralAmount: bigint;
  /** This pair's rate: collateral per asset × 1e18. */
  exchangeRate: bigint | undefined;
}

/** Isolated legs in USD: asset legs at the asset's oracle price, collateral via the pair's rate. */
export function isolatedLegsUsd(positions: readonly IsolatedPositionLike[], priceOf: PriceOf, incomplete = false) {
  if (incomplete) return { supply: undefined, debt: undefined, collateral: undefined };
  return {
    supply: sumUsd(positions.map((p) => usdValue(p.suppliedAssets, p.assetDecimals, priceOf(p.asset)))),
    debt: sumUsd(positions.map((p) => usdValue(p.borrowedAssets, p.assetDecimals, priceOf(p.asset)))),
    collateral: sumUsd(
      positions.map((p) => isolatedCollateralUsd(p.collateralAmount, p.exchangeRate, p.assetDecimals, priceOf(p.asset))),
    ),
  };
}
