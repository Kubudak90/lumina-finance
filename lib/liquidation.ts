/**
 * Aave v3.2 liquidation limits, mirrored from lumina-core
 * src/contracts/protocol/libraries/logic/LiquidationLogic.sol (branch lighter-devnet-v1):
 *
 *   DEFAULT_LIQUIDATION_CLOSE_FACTOR = 0.5e4   // HF above the threshold
 *   MAX_LIQUIDATION_CLOSE_FACTOR     = 1e4     // HF at or below the threshold
 *   CLOSE_FACTOR_HF_THRESHOLD        = 0.95e18
 *
 * `_calculateDebt`: closeFactor = HF > threshold ? DEFAULT : MAX; maxLiquidatableDebt =
 * userVariableDebt.percentMul(closeFactor). `_calculateAvailableCollateralToLiquidate` then caps by
 * the collateral available at the liquidation bonus (PercentageMath half-up rounding).
 */

import { vaultToAmount, vaultToShares, type VaultTotals } from "./approvals";
import { EXCHANGE_PRECISION } from "./borrowMax";

export const DEFAULT_LIQUIDATION_CLOSE_FACTOR = 5_000n;
export const MAX_LIQUIDATION_CLOSE_FACTOR = 10_000n;
export const CLOSE_FACTOR_HF_THRESHOLD = 95n * 10n ** 16n; // 0.95e18
export const HEALTH_FACTOR_LIQUIDATION_THRESHOLD = 10n ** 18n;

const PERCENTAGE_FACTOR = 10_000n;
const HALF_PERCENTAGE_FACTOR = 5_000n;

/** PercentageMath.percentMul (half up). */
export function percentMul(value: bigint, percentage: bigint): bigint {
  return (value * percentage + HALF_PERCENTAGE_FACTOR) / PERCENTAGE_FACTOR;
}

/** PercentageMath.percentDiv (half up). */
export function percentDiv(value: bigint, percentage: bigint): bigint {
  return (value * PERCENTAGE_FACTOR + percentage / 2n) / percentage;
}

export function closeFactorFor(healthFactor: bigint): bigint {
  return healthFactor > CLOSE_FACTOR_HF_THRESHOLD ? DEFAULT_LIQUIDATION_CLOSE_FACTOR : MAX_LIQUIDATION_CLOSE_FACTOR;
}

export interface LiquidationLimitInput {
  healthFactor: bigint;
  /** Borrower's variable debt in the debt asset (base units). */
  userDebt: bigint;
  /** Borrower's aToken balance of the collateral asset (base units). */
  collateralBalance: bigint;
  debtPrice: bigint;
  collateralPrice: bigint;
  debtDecimals: number;
  collateralDecimals: number;
  /** Collateral reserve liquidation bonus as Aave stores it (10000 + bonus, e.g. 10500). */
  liquidationBonus: bigint;
}

export interface LiquidationLimit {
  closeFactor: bigint;
  /** userDebt.percentMul(closeFactor). */
  closeFactorDebt: bigint;
  /** Largest `debtToCover` the pool will actually use. */
  maxDebtToCover: bigint;
  /** True when the collateral at the bonus, not the close factor, sets the limit. */
  collateralLimited: boolean;
}

/** The debt a single liquidationCall can repay for this (debt, collateral) pair. */
export function maxLiquidatableDebt(input: LiquidationLimitInput): LiquidationLimit | null {
  const { healthFactor, userDebt, collateralBalance, debtPrice, collateralPrice, liquidationBonus } = input;
  if (healthFactor >= HEALTH_FACTOR_LIQUIDATION_THRESHOLD) return null;
  if (debtPrice <= 0n || collateralPrice <= 0n || liquidationBonus <= 0n) return null;
  const closeFactor = closeFactorFor(healthFactor);
  const closeFactorDebt = percentMul(userDebt, closeFactor);
  const collateralUnit = 10n ** BigInt(input.collateralDecimals);
  const debtUnit = 10n ** BigInt(input.debtDecimals);

  const baseCollateral = (debtPrice * closeFactorDebt * collateralUnit) / (collateralPrice * debtUnit);
  const maxCollateralToLiquidate = percentMul(baseCollateral, liquidationBonus);
  if (maxCollateralToLiquidate > collateralBalance) {
    const debtAmountNeeded = percentDiv(
      (collateralPrice * collateralBalance * debtUnit) / (debtPrice * collateralUnit),
      liquidationBonus,
    );
    return { closeFactor, closeFactorDebt, maxDebtToCover: debtAmountNeeded, collateralLimited: true };
  }
  return { closeFactor, closeFactorDebt, maxDebtToCover: closeFactorDebt, collateralLimited: false };
}

// =============================================================================================
// Isolated pair (LightlendPairCore.liquidate) exact integer arithmetic & F5/F8 amount policy
// =============================================================================================

/** LightlendPairConstants.LIQ_PRECISION (1e5 = 100%). */
export const LIQ_PRECISION = 100_000n;
/** F2: gas forwarded to the dual oracle guard call, plus safety buffer, for pair `liquidate`. */
export const GUARD_CALL_GAS = 1_000_000n;
export const ISOLATED_LIQ_GAS_BUFFER = 100_000n;
export const ISOLATED_LIQ_GAS_PADDING = GUARD_CALL_GAS + ISOLATED_LIQ_GAS_BUFFER;
/** F8: pair `liquidate` deadline (seconds from send). */
export const ISOLATED_LIQ_DEADLINE_SEC = 120;
/** F8: 1% margin on the collateral value (100 bps out of 10,000). */
export const ISOLATED_LIQ_MARGIN_BPS = 100n;
const MARGIN_BPS_DENOMINATOR = 10_000n;

export interface IsolatedLiquidationParams {
  /** Borrower's total borrow shares (`userBorrowShares[borrower]`). */
  borrowerShares: bigint;
  /** Borrower's collateral balance (`userCollateralBalance[borrower]`). */
  collateral: bigint;
  /** Previewed pair totalBorrow vault totals (`getPairAccounting` / `previewAddInterest`). */
  totalBorrow: VaultTotals;
  /** Pair liquidation exchange rate (`lowExchangeRate`: collateral per asset × 1e18). */
  exchangeRate: bigint;
  /** Pair `cleanLiquidationFee` (1e5 precision). */
  cleanLiquidationFee: bigint;
  /** Pair `dirtyLiquidationFee` (1e5 precision). */
  dirtyLiquidationFee: bigint;
  /** Pair `protocolLiquidationFee` (1e5 precision, share of bonus only — ISO-01). */
  protocolLiquidationFee: bigint;
}

export interface IsolatedLiquidationOutcome {
  /** Effective shares liquidated (clamped to `borrowerShares`). */
  shares: bigint;
  /** Branch calculation amount: `toAmount(shares, false)` (rounds down). */
  amountDown: bigint;
  /** Repaid debt value in collateral units: `amountDown * exchangeRate / 1e18`. */
  liquidationAmountInCollateralUnits: bigint;
  /** Optimistic collateral under `cleanLiquidationFee` (determines clean vs dirty). */
  optimisticCollateral: bigint;
  /** True when `optimisticCollateral >= collateral` (clean path: takes all collateral, writes off unpaid shares). */
  isClean: boolean;
  /** Gross collateral removed from borrower (`collateralReceived + protocolFee`). */
  collateralSeized: bigint;
  /** Protocol share of the liquidation bonus (0 if no bonus or fee is 0). */
  protocolFee: bigint;
  /** Net collateral delivered to liquidator (`collateralSeized - protocolFee`). */
  collateralReceived: bigint;
  /** Asset amount pulled from liquidator: `toAmount(shares, true)` (rounds up). */
  repayment: bigint;
  /** Unpaid shares written off (`borrowerShares - shares` when clean, 0 when dirty). */
  sharesToAdjust: bigint;
  /** Bad debt written off in asset units: `toAmount(sharesToAdjust, false)` (0 when dirty). */
  writeOff: bigint;
}

/**
 * Exact reproduction of `LightlendPairCore.liquidate` integer arithmetic (lines 1144–1209):
 * branch and write-off calculations round down (`toAmount(..., false)`), repayment rounds up
 * (`toAmount(..., true)`), and the protocol fee applies to the bonus only (ISO-01).
 */
export function simulateIsolatedLiquidation(
  params: IsolatedLiquidationParams,
  sharesToLiquidate: bigint,
): IsolatedLiquidationOutcome {
  const shares = sharesToLiquidate <= 0n ? 0n : sharesToLiquidate > params.borrowerShares ? params.borrowerShares : sharesToLiquidate;
  if (shares === 0n || params.exchangeRate <= 0n) {
    return {
      shares: 0n,
      amountDown: 0n,
      liquidationAmountInCollateralUnits: 0n,
      optimisticCollateral: 0n,
      isClean: false,
      collateralSeized: 0n,
      protocolFee: 0n,
      collateralReceived: 0n,
      repayment: 0n,
      sharesToAdjust: 0n,
      writeOff: 0n,
    };
  }

  const amountDown = vaultToAmount(params.totalBorrow, shares, false);
  const liquidationAmountInCollateralUnits = (amountDown * params.exchangeRate) / EXCHANGE_PRECISION;
  const optimisticCollateral =
    (liquidationAmountInCollateralUnits * (LIQ_PRECISION + params.cleanLiquidationFee)) / LIQ_PRECISION;
  const isClean = optimisticCollateral >= params.collateral;

  const collateralSeized = isClean
    ? params.collateral
    : (liquidationAmountInCollateralUnits * (LIQ_PRECISION + params.dirtyLiquidationFee)) / LIQ_PRECISION;

  let protocolFee = 0n;
  if (params.protocolLiquidationFee > 0n && collateralSeized > liquidationAmountInCollateralUnits) {
    protocolFee =
      (params.protocolLiquidationFee * (collateralSeized - liquidationAmountInCollateralUnits)) / LIQ_PRECISION;
  }
  const collateralReceived = collateralSeized - protocolFee;
  const repayment = vaultToAmount(params.totalBorrow, shares, true);

  const sharesToAdjust = isClean ? params.borrowerShares - shares : 0n;
  const writeOff = sharesToAdjust > 0n ? vaultToAmount(params.totalBorrow, sharesToAdjust, false) : 0n;

  return {
    shares,
    amountDown,
    liquidationAmountInCollateralUnits,
    optimisticCollateral,
    isClean,
    collateralSeized,
    protocolFee,
    collateralReceived,
    repayment,
    sharesToAdjust,
    writeOff,
  };
}

/** True when `repayment` exceeds the value of `collateralReceived` at `exchangeRate` (exact integer comparison). */
export function repaymentExceedsCollateral(
  outcome: Pick<IsolatedLiquidationOutcome, "repayment" | "collateralReceived">,
  exchangeRate: bigint,
): boolean {
  if (exchangeRate <= 0n) return true;
  return outcome.repayment * exchangeRate > outcome.collateralReceived * EXCHANGE_PRECISION;
}

/**
 * True when `collateralReceived` covers `repayment` after applying `marginBps` on the collateral value:
 * `repayment * exchangeRate * 10_000 <= collateralReceived * 1e18 * (10_000 - marginBps)`.
 */
export function fitsLiquidationMargin(
  outcome: Pick<IsolatedLiquidationOutcome, "repayment" | "collateralReceived">,
  exchangeRate: bigint,
  marginBps: bigint = ISOLATED_LIQ_MARGIN_BPS,
): boolean {
  if (exchangeRate <= 0n || marginBps < 0n || marginBps > MARGIN_BPS_DENOMINATOR) return false;
  return (
    outcome.repayment * exchangeRate * MARGIN_BPS_DENOMINATOR <=
    outcome.collateralReceived * EXCHANGE_PRECISION * (MARGIN_BPS_DENOMINATOR - marginBps)
  );
}

export interface IsolatedLiquidationPolicyResult {
  /** Chosen MAX share count (0n if no positive share amount satisfies the policy and margin). */
  shares: bigint;
  /** True when the collateral received on full repayment is worth at least the full debt. */
  hasEquity: boolean;
  /** Policy branch chosen: full repayment, dirty partial, clean partial, or none. */
  mode: "full" | "dirty" | "clean" | "none";
  /** Simulated outcome for `shares`, or null when `shares === 0n`. */
  outcome: IsolatedLiquidationOutcome | null;
}

function isCleanAt(params: IsolatedLiquidationParams, shares: bigint): boolean {
  const amountDown = vaultToAmount(params.totalBorrow, shares, false);
  const liqAmt = (amountDown * params.exchangeRate) / EXCHANGE_PRECISION;
  const optimistic = (liqAmt * (LIQ_PRECISION + params.cleanLiquidationFee)) / LIQ_PRECISION;
  return optimistic >= params.collateral;
}

/** Smallest `s` in `[1, borrowerShares]` that enters the clean branch, or null if none does. */
function findCleanBoundary(params: IsolatedLiquidationParams): bigint | null {
  if (!isCleanAt(params, params.borrowerShares)) return null;
  let lo = 1n;
  let hi = params.borrowerShares;
  while (lo < hi) {
    const mid = lo + (hi - lo) / 2n;
    if (isCleanAt(params, mid)) hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

function findLargestDirty(
  params: IsolatedLiquidationParams,
  dirtyMax: bigint,
  marginBps: bigint,
): IsolatedLiquidationOutcome | null {
  if (dirtyMax <= 0n) return null;
  const top = simulateIsolatedLiquidation(params, dirtyMax);
  if (!top.isClean && fitsLiquidationMargin(top, params.exchangeRate, marginBps)) return top;
  // Handle any local 1-wei rounding dip at dirtyMax by checking the best share count of smaller repayments.
  let repay = top.repayment;
  for (let i = 0; i < 64 && repay > 1n; i++) {
    repay -= 1n;
    const candidate = vaultToShares(params.totalBorrow, repay, false);
    if (candidate <= 0n) break;
    const clamped = candidate < dirtyMax ? candidate : dirtyMax - 1n;
    if (clamped <= 0n) break;
    const sim = simulateIsolatedLiquidation(params, clamped);
    if (!sim.isClean && fitsLiquidationMargin(sim, params.exchangeRate, marginBps)) return sim;
  }
  return null;
}

function findLargestClean(
  params: IsolatedLiquidationParams,
  cleanMin: bigint,
  marginBps: bigint,
): IsolatedLiquidationOutcome | null {
  const mNum = MARGIN_BPS_DENOMINATOR - marginBps;
  const mDen = MARGIN_BPS_DENOMINATOR;
  const f = params.protocolLiquidationFee;
  const L = LIQ_PRECISION;

  let hi = params.borrowerShares;
  const denom = params.exchangeRate * (L * mDen - f * mNum);
  if (f <= L && denom > 0n) {
    const numer = mNum * EXCHANGE_PRECISION * ((L - f) * params.collateral + (L - 1n));
    const upperShares = vaultToShares(params.totalBorrow, numer / denom, false);
    if (upperShares < hi) hi = upperShares;
  }

  while (hi >= cleanMin) {
    const sim = simulateIsolatedLiquidation(params, hi);
    if (fitsLiquidationMargin(sim, params.exchangeRate, marginBps)) return sim;
    // collateralReceived(s) is monotonically non-decreasing in s on the clean region, so every
    // feasible s <= hi must have repayment(s) <= floor(collateralReceived(hi) * 1e18 * mNum / (R * mDen)).
    const nextMaxRepay = (sim.collateralReceived * EXCHANGE_PRECISION * mNum) / (params.exchangeRate * mDen);
    const nextHi = vaultToShares(params.totalBorrow, nextMaxRepay, false);
    hi = nextHi < hi ? nextHi : hi - 1n;
  }
  return null;
}

/**
 * F5/F8 isolated liquidation amount policy with a zero profit floor and `marginBps` margin
 * on the collateral value (default 1% = 100 bps):
 * 1. Position has equity (`collateralReceived >= repayment` on full repayment):
 *    repay in full if it fits inside the margin; otherwise take the largest dirty partial that
 *    fits inside the margin (never a clean partial); otherwise 0.
 * 2. Position is under water:
 *    take the largest clean share count that stays inside the margin; otherwise 0.
 */
export function isolatedLiquidationMax(
  params: IsolatedLiquidationParams,
  marginBps: bigint = ISOLATED_LIQ_MARGIN_BPS,
): IsolatedLiquidationPolicyResult {
  if (params.borrowerShares <= 0n || params.collateral <= 0n || params.exchangeRate <= 0n) {
    return { shares: 0n, hasEquity: false, mode: "none", outcome: null };
  }

  const full = simulateIsolatedLiquidation(params, params.borrowerShares);
  const hasEquity = !repaymentExceedsCollateral(full, params.exchangeRate);

  if (hasEquity) {
    if (fitsLiquidationMargin(full, params.exchangeRate, marginBps)) {
      return { shares: full.shares, hasEquity: true, mode: "full", outcome: full };
    }
    const cleanMin = findCleanBoundary(params);
    const dirtyMax = cleanMin === null ? params.borrowerShares : cleanMin - 1n;
    const dirty = findLargestDirty(params, dirtyMax, marginBps);
    if (dirty) return { shares: dirty.shares, hasEquity: true, mode: "dirty", outcome: dirty };
    return { shares: 0n, hasEquity: true, mode: "none", outcome: null };
  }

  const cleanMin = findCleanBoundary(params);
  if (cleanMin === null) return { shares: 0n, hasEquity: false, mode: "none", outcome: null };
  const clean = findLargestClean(params, cleanMin, marginBps);
  if (clean) return { shares: clean.shares, hasEquity: false, mode: "clean", outcome: clean };
  return { shares: 0n, hasEquity: false, mode: "none", outcome: null };
}
