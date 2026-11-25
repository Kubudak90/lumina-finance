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

import { VAULT_VIRTUAL_AMOUNT, VAULT_VIRTUAL_SHARES, vaultToAmount, vaultToShares, type VaultTotals } from "./approvals";
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

/**
 * True when, after liquidating `outcome.shares` on the dirty path, the borrower's remaining debt
 * (`toAmount(borrowerShares - shares, true)`) is covered by the remaining collateral
 * (`collateral - collateralSeized`, gross including the protocol's share) at `exchangeRate`:
 * `remainingDebt * exchangeRate <= remainingCollateral * 1e18`.
 */
export function isRemainderCovered(
  params: Pick<IsolatedLiquidationParams, "borrowerShares" | "collateral" | "totalBorrow" | "exchangeRate">,
  outcome: Pick<IsolatedLiquidationOutcome, "shares" | "collateralSeized">,
): boolean {
  if (params.exchangeRate <= 0n || outcome.collateralSeized > params.collateral) return false;
  const remainingCollateral = params.collateral - outcome.collateralSeized;
  const remainingShares = params.borrowerShares > outcome.shares ? params.borrowerShares - outcome.shares : 0n;
  const remainingDebt = remainingShares > 0n ? vaultToAmount(params.totalBorrow, remainingShares, true) : 0n;
  return remainingDebt * params.exchangeRate <= remainingCollateral * EXCHANGE_PRECISION;
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

/**
 * Exact largest share count `s` in `[1, dirtyMax]` with `liquidationAmountInCollateralUnits === k`
 * that satisfies both `fitsLiquidationMargin` and `isRemainderCovered`, or null if none exists.
 */
function bestInLiqAmtPlateau(
  params: IsolatedLiquidationParams,
  k: bigint,
  dirtyMax: bigint,
  marginBps: bigint,
): IsolatedLiquidationOutcome | null {
  if (k <= 0n) return null;
  const R = params.exchangeRate;
  const A = params.totalBorrow.amount + VAULT_VIRTUAL_AMOUNT;
  const S = params.totalBorrow.shares + VAULT_VIRTUAL_SHARES;

  const aMin = (k * EXCHANGE_PRECISION + R - 1n) / R;
  const aMax = ((k + 1n) * EXCHANGE_PRECISION - 1n) / R;
  if (aMin > aMax) return null;

  let sMin = (aMin * S + A - 1n) / A;
  if (sMin < 1n) sMin = 1n;
  let sMax = ((aMax + 1n) * S - 1n) / A;
  if (sMax > dirtyMax) sMax = dirtyMax;
  if (sMin > sMax) return null;

  const simMax = simulateIsolatedLiquidation(params, sMax);
  if (simMax.isClean) return null;
  if (fitsLiquidationMargin(simMax, R, marginBps)) {
    return isRemainderCovered(params, simMax) ? simMax : null;
  }

  // Within plateau k, collateralReceived is constant; find the largest s in [sMin, sMax] fitting margin.
  const mNum = MARGIN_BPS_DENOMINATOR - marginBps;
  const maxRepay = (simMax.collateralReceived * EXCHANGE_PRECISION * mNum) / (R * MARGIN_BPS_DENOMINATOR);
  const sCand = vaultToShares(params.totalBorrow, maxRepay, false);
  if (sCand < sMin) return null;
  const clamped = sCand < sMax ? sCand : sMax;
  const sim = simulateIsolatedLiquidation(params, clamped);
  if (!sim.isClean && fitsLiquidationMargin(sim, R, marginBps) && isRemainderCovered(params, sim)) {
    return sim;
  }
  return null;
}

const EXACT_SCAN_LIMIT = 4_096n;

function findLargestDirty(
  params: IsolatedLiquidationParams,
  dirtyMax: bigint,
  marginBps: bigint,
): IsolatedLiquidationOutcome | null {
  if (dirtyMax <= 0n || marginBps < 0n || marginBps > MARGIN_BPS_DENOMINATOR) return null;
  const R = params.exchangeRate;
  const D = params.dirtyLiquidationFee;
  const mNum = MARGIN_BPS_DENOMINATOR - marginBps;
  // Even the gross dirty bonus D/LIQ_PRECISION cannot clear marginBps when LIQ_PRECISION * mDen > (LIQ_PRECISION + D) * mNum.
  if (D < 0n || LIQ_PRECISION * MARGIN_BPS_DENOMINATOR > (LIQ_PRECISION + D) * mNum) return null;

  const simDirtyMax = simulateIsolatedLiquidation(params, dirtyMax);
  const kDirtyMax = simDirtyMax.liquidationAmountInCollateralUnits;
  if (kDirtyMax <= 0n) return null;

  if (D === 0n) {
    // Only reachable with marginBps === 0n: bonus is 0 everywhere on the dirty path.
    const top = bestInLiqAmtPlateau(params, kDirtyMax, dirtyMax, marginBps);
    if (top) return top;
    let repay = simDirtyMax.repayment;
    for (let i = 0; i < 64 && repay > 1n; i++) {
      repay -= 1n;
      const candidate = vaultToShares(params.totalBorrow, repay, false);
      if (candidate <= 0n) break;
      const clamped = candidate < dirtyMax ? candidate : dirtyMax - 1n;
      if (clamped <= 0n) break;
      const sim = simulateIsolatedLiquidation(params, clamped);
      if (!sim.isClean && fitsLiquidationMargin(sim, R, marginBps) && isRemainderCovered(params, sim)) return sim;
    }
    return null;
  }

  // Exact upper bound on dirty bonus: remainingDebt(s) + amountDown(s) >= floor(B * A / S) = baseDebt,
  // and liqAmt(s) * 1e18 >= amountDown(s) * R - (1e18 - 1), so any covered s must satisfy
  // bonus(liqAmt(s)) * 1e18 <= collateral * 1e18 - baseDebt * R + (1e18 - 1).
  const baseDebt = vaultToAmount(params.totalBorrow, params.borrowerShares, false);
  const headroom = params.collateral * EXCHANGE_PRECISION - baseDebt * R + (EXCHANGE_PRECISION - 1n);
  if (headroom < 0n) return null;
  const maxBonus = headroom / EXCHANGE_PRECISION;
  if (maxBonus === 0n && marginBps > 0n) return null;

  const kMaxByBonus = ((maxBonus + 1n) * LIQ_PRECISION - 1n) / D;
  const kHi = kMaxByBonus < kDirtyMax ? kMaxByBonus : kDirtyMax;
  if (kHi <= 0n) return null;

  // Guaranteed coverage lower bound: remainingDebt(s) + amountDown(s) <= baseDebt + 1 and liqAmt(s) * 1e18 <= amountDown(s) * R,
  // so every s with bonus(liqAmt(s)) * 1e18 <= collateral * 1e18 - (baseDebt + 1) * R is guaranteed covered.
  const guarHeadroom = params.collateral * EXCHANGE_PRECISION - (baseDebt + 1n) * R;
  const kGuarRaw = guarHeadroom >= 0n ? ((guarHeadroom / EXCHANGE_PRECISION + 1n) * LIQ_PRECISION - 1n) / D : 0n;
  const kGuar = kGuarRaw < kHi ? kGuarRaw : kHi;

  const cycleSteps = (LIQ_PRECISION + D - 1n) / D + 2n;
  const guarScan = cycleSteps > 64n ? cycleSteps : 64n;

  // Asymptotic net bonus ceiling (when protocolFee rounding at small k can clear marginBps even if steady-state net bonus cannot).
  const netDenom =
    MARGIN_BPS_DENOMINATOR * LIQ_PRECISION * LIQ_PRECISION -
    mNum * (LIQ_PRECISION * LIQ_PRECISION + D * (LIQ_PRECISION - params.protocolLiquidationFee));
  const kNetCeiling = netDenom > 0n ? (mNum * LIQ_PRECISION * LIQ_PRECISION) / netDenom : null;

  if (R <= EXCHANGE_PRECISION) {
    // Dense in k = liquidationAmountInCollateralUnits (e.g. WETH debt / USDC collateral).
    if (kHi - kGuar <= EXACT_SCAN_LIMIT) {
      for (let k = kHi; k > kGuar; k -= 1n) {
        const cand = bestInLiqAmtPlateau(params, k, dirtyMax, marginBps);
        if (cand) return cand;
      }
    } else {
      let lo = kGuar + 1n;
      let hi = kHi;
      let best: IsolatedLiquidationOutcome | null = null;
      while (lo <= hi) {
        const mid = lo + (hi - lo) / 2n;
        const cand = bestInLiqAmtPlateau(params, mid, dirtyMax, marginBps);
        if (cand) {
          best = cand;
          lo = mid + 1n;
        } else {
          hi = mid - 1n;
        }
      }
      if (best) return best;
    }

    if (kGuar > 0n) {
      const floorK = kGuar > guarScan ? kGuar - guarScan : 0n;
      for (let k = kGuar; k > floorK; k -= 1n) {
        const cand = bestInLiqAmtPlateau(params, k, dirtyMax, marginBps);
        if (cand) return cand;
      }
      if (kNetCeiling !== null && kNetCeiling > 0n && kNetCeiling <= floorK) {
        const netFloor = kNetCeiling > EXACT_SCAN_LIMIT ? kNetCeiling - EXACT_SCAN_LIMIT : 0n;
        for (let k = kNetCeiling; k > netFloor; k -= 1n) {
          const cand = bestInLiqAmtPlateau(params, k, dirtyMax, marginBps);
          if (cand) return cand;
        }
      }
    }
    return null;
  }

  // R > EXCHANGE_PRECISION: dense in a = amountDown (e.g. USDC debt / WETH collateral).
  const aDirtyMax = simDirtyMax.amountDown;
  const aMaxByK = ((kHi + 1n) * EXCHANGE_PRECISION - 1n) / R;
  const aHi = aMaxByK < aDirtyMax ? aMaxByK : aDirtyMax;
  if (aHi <= 0n) return null;
  const aGuarRaw = kGuar > 0n ? ((kGuar + 1n) * EXCHANGE_PRECISION - 1n) / R : 0n;
  const aGuar = aGuarRaw < aHi ? aGuarRaw : aHi;

  const bestAtA = (a: bigint) => bestInLiqAmtPlateau(params, (a * R) / EXCHANGE_PRECISION, dirtyMax, marginBps);

  if (aHi - aGuar <= EXACT_SCAN_LIMIT) {
    for (let a = aHi; a > aGuar; a -= 1n) {
      const cand = bestAtA(a);
      if (cand) return cand;
    }
  } else {
    let lo = aGuar + 1n;
    let hi = aHi;
    let best: IsolatedLiquidationOutcome | null = null;
    while (lo <= hi) {
      const mid = lo + (hi - lo) / 2n;
      const cand = bestAtA(mid);
      if (cand) {
        best = cand;
        lo = mid + 1n;
      } else {
        hi = mid - 1n;
      }
    }
    if (best) return best;
  }

  if (aGuar > 0n) {
    const floorA = aGuar > guarScan ? aGuar - guarScan : 0n;
    for (let a = aGuar; a > floorA; a -= 1n) {
      const cand = bestAtA(a);
      if (cand) return cand;
    }
    if (kNetCeiling !== null) {
      const aNetCeiling = ((kNetCeiling + 1n) * EXCHANGE_PRECISION - 1n) / R;
      if (aNetCeiling > 0n && aNetCeiling <= floorA) {
        const netFloor = aNetCeiling > EXACT_SCAN_LIMIT ? aNetCeiling - EXACT_SCAN_LIMIT : 0n;
        for (let a = aNetCeiling; a > netFloor; a -= 1n) {
          const cand = bestAtA(a);
          if (cand) return cand;
        }
      }
    }
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
 * F5/F8 isolated liquidation amount policy (spec rev 3.1) with a zero profit floor and `marginBps`
 * margin on the collateral value (default 1% = 100 bps):
 * 1. Position has equity (`collateralReceived >= repayment` on full repayment):
 *    repay in full if it fits inside the margin; otherwise take the largest dirty partial that
 *    both fits inside the margin and leaves the borrower's remaining debt covered by the remaining
 *    collateral (never a clean partial); otherwise 0.
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
