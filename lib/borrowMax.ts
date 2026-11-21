/**
 * Borrow MAX (FE-05). All bigint, all floored to the token's base units.
 *
 * Core: Aave limits borrows by LTV (`ValidationLogic.validateBorrow`: (debt + amount) / ltv <=
 * collateral), which `getUserAccountData().availableBorrowsBase` already reports. MAX is 99% of it,
 * converted with the AaveOracle price, capped by the reserve's available liquidity and borrow-cap
 * headroom.
 *
 * Isolated: the pair is solvent while debt × rate / 1e18 × 1e5 / collateral <= maxLTV, using the
 * pair oracle's exchange rate (collateral units per asset unit, 1e18). MAX is 99% of the room left
 * under that limit, capped by the pair's free liquidity and its borrow limit.
 */

export const BPS = 10_000n;
/** 99% of the computed capacity. */
export const BORROW_MAX_HAIRCUT_BPS = 9_900n;

/** FraxLend precisions (LightlendPairConstants). */
export const LTV_PRECISION = 100_000n;
export const EXCHANGE_PRECISION = 10n ** 18n;

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const sub0 = (a: bigint, b: bigint) => (a > b ? a - b : 0n);

export interface CoreBorrowMaxInput {
  /** getUserAccountData().availableBorrowsBase (base currency, 8 decimals USD). */
  availableBorrowsBase: bigint;
  /** AaveOracle.getAssetPrice(asset) (same base currency). */
  assetPriceBase: bigint;
  decimals: number;
  /** Pool.getVirtualUnderlyingBalance(asset): what the reserve can lend out. */
  availableLiquidity: bigint;
  /** DataProvider.getReserveCaps(asset).borrowCap in whole tokens; 0 = no cap. */
  borrowCapTokens: bigint;
  /** DataProvider.getTotalDebt(asset) in base units. */
  totalDebt: bigint;
}

export function coreBorrowMax(input: CoreBorrowMaxInput): bigint {
  const { availableBorrowsBase, assetPriceBase, decimals, availableLiquidity, borrowCapTokens, totalDebt } = input;
  if (assetPriceBase <= 0n || availableBorrowsBase <= 0n) return 0n;
  const unit = 10n ** BigInt(decimals);
  // One division: floor(available × 99% × 10^decimals / price).
  let max = (availableBorrowsBase * BORROW_MAX_HAIRCUT_BPS * unit) / (BPS * assetPriceBase);
  max = min(max, availableLiquidity > 0n ? availableLiquidity : 0n);
  if (borrowCapTokens > 0n) max = min(max, sub0(borrowCapTokens * unit, totalDebt));
  return max;
}

export interface IsolatedBorrowMaxInput {
  /** Collateral after this transaction (current + collateral added with the borrow). */
  collateral: bigint;
  /** Current debt in asset units: toBorrowAmount(userBorrowShares, roundUp = true, preview = true). */
  currentDebt: bigint;
  /** Pair oracle rate (collateral per asset × 1e18); the pair checks solvency at the high rate. */
  exchangeRate: bigint;
  /** pair.maxLTV() (1e5 = 100%). */
  maxLtv: bigint;
  /** totalAsset.amount − totalBorrow.amount. */
  availableLiquidity: bigint;
  /** pair.borrowLimit() and the current totalBorrow.amount. */
  borrowLimit: bigint;
  totalBorrow: bigint;
}

export function isolatedBorrowMax(input: IsolatedBorrowMaxInput): bigint {
  const { collateral, currentDebt, exchangeRate, maxLtv, availableLiquidity, borrowLimit, totalBorrow } = input;
  if (exchangeRate <= 0n || maxLtv <= 0n || collateral <= 0n) return 0n;
  const maxDebt = (collateral * maxLtv * EXCHANGE_PRECISION) / (LTV_PRECISION * exchangeRate);
  let max = (sub0(maxDebt, currentDebt) * BORROW_MAX_HAIRCUT_BPS) / BPS;
  max = min(max, availableLiquidity > 0n ? availableLiquidity : 0n);
  max = min(max, sub0(borrowLimit, totalBorrow));
  return max;
}

/**
 * Isolated LTV of a position in 1e5 units, as the pair computes it (rounded down at each step,
 * like `_isSolvent`). Null when there is no collateral.
 */
export function isolatedLtv(debt: bigint, collateral: bigint, exchangeRate: bigint): bigint | null {
  if (collateral <= 0n) return null;
  return (((debt * exchangeRate) / EXCHANGE_PRECISION) * LTV_PRECISION) / collateral;
}

/** Collateral amount expressed in asset units at the pair's exchange rate (floored). */
export function collateralInAsset(collateral: bigint, exchangeRate: bigint): bigint {
  if (exchangeRate <= 0n) return 0n;
  return (collateral * EXCHANGE_PRECISION) / exchangeRate;
}

type Maybe<T> = { [K in keyof T]: T[K] | undefined };

/**
 * Borrow MAX from on-chain reads that may have failed (Codex r1 #9). Returns null — "unavailable" —
 * when any input the limit depends on is missing; a failed read is never treated as zero.
 * `totalDebt` is only needed when there is a borrow cap.
 */
export function coreBorrowMaxFromReads(input: Maybe<CoreBorrowMaxInput>): bigint | null {
  const { availableBorrowsBase, assetPriceBase, decimals, availableLiquidity, borrowCapTokens, totalDebt } = input;
  if (
    availableBorrowsBase === undefined ||
    assetPriceBase === undefined ||
    decimals === undefined ||
    availableLiquidity === undefined ||
    borrowCapTokens === undefined ||
    (borrowCapTokens > 0n && totalDebt === undefined)
  ) {
    return null;
  }
  return coreBorrowMax({
    availableBorrowsBase,
    assetPriceBase,
    decimals,
    availableLiquidity,
    borrowCapTokens,
    totalDebt: totalDebt ?? 0n,
  });
}

/** Isolated borrow MAX from reads that may have failed; null when any input is missing. */
export function isolatedBorrowMaxFromReads(input: Maybe<IsolatedBorrowMaxInput>): bigint | null {
  const { collateral, currentDebt, exchangeRate, maxLtv, availableLiquidity, borrowLimit, totalBorrow } = input;
  if (
    collateral === undefined ||
    currentDebt === undefined ||
    exchangeRate === undefined ||
    maxLtv === undefined ||
    availableLiquidity === undefined ||
    borrowLimit === undefined ||
    totalBorrow === undefined
  ) {
    return null;
  }
  return isolatedBorrowMax({ collateral, currentDebt, exchangeRate, maxLtv, availableLiquidity, borrowLimit, totalBorrow });
}
