/**
 * Approval amounts (spec §3.3, FE-04, FE-09, review R1-5 / R2-1).
 *
 * - Supply, deposit and add-collateral approve exactly the amount being moved.
 * - Every repay, partial or full, on both venues approves `ceil(assetValue × 1.001) + 1`, where
 *   `assetValue` is the current value of the debt (core) or of the borrow shares (isolated) being
 *   repaid. Interest accrued between the approve block and the repay block then fits in the 10 bps
 *   buffer (spec §6.1 FE criterion, `coversAccrual` below).
 * - No unlimited approval and no credit delegation exist anywhere: `assertBoundedApproval` rejects
 *   any allowance at or above 2^128 (larger than any real token amount; Aave and FraxLend both
 *   store amounts as uint128).
 */

/** Largest allowance the app will ever request. */
export const MAX_APPROVAL = (1n << 128n) - 1n;

export const REPAY_BUFFER_NUMERATOR = 1001n;
export const REPAY_BUFFER_DENOMINATOR = 1000n;

/**
 * Aave `Pool.repay` / `Pool.withdraw` sentinel for "the entire debt / balance" (FE-09). It is an
 * `amount` argument, never an allowance: the pool pulls the debt as of the repay block, which the
 * buffered approval covers.
 */
export const AAVE_ENTIRE_BALANCE = (1n << 256n) - 1n;

export class UnboundedApprovalError extends Error {
  constructor(amount: bigint) {
    super(`refusing approval of ${amount}: approvals must be > 0 and <= 2^128 - 1`);
    this.name = "UnboundedApprovalError";
  }
}

/** Returns `amount` if it is a bounded, non-zero allowance; throws otherwise. */
export function assertBoundedApproval(amount: bigint): bigint {
  if (amount <= 0n || amount > MAX_APPROVAL) throw new UnboundedApprovalError(amount);
  return amount;
}

/** Supply / deposit / add-collateral / liquidation: approve exactly what moves. */
export function exactApproval(amount: bigint): bigint {
  return assertBoundedApproval(amount);
}

/** ceil(x × 1001 / 1000) */
export function ceilWithRepayBuffer(assetValue: bigint): bigint {
  if (assetValue < 0n) throw new RangeError("asset value must be >= 0");
  return (assetValue * REPAY_BUFFER_NUMERATOR + REPAY_BUFFER_DENOMINATOR - 1n) / REPAY_BUFFER_DENOMINATOR;
}

/** Repay approval: ceil(assetValue × 1.001) + 1. */
export function repayApproval(assetValue: bigint): bigint {
  if (assetValue <= 0n) throw new RangeError("nothing to repay");
  return assertBoundedApproval(ceilWithRepayBuffer(assetValue) + 1n);
}

/** True when the current allowance does not cover `required` (unknown allowance ⇒ approve). */
export function needsApproval(allowance: bigint | undefined, required: bigint): boolean {
  if (required <= 0n) return false;
  if (allowance === undefined) return true;
  return allowance < required;
}

/** Allowance left behind after `pulled` is transferred from an allowance of `approved`. */
export function residualAllowance(approved: bigint, pulled: bigint): bigint {
  return approved > pulled ? approved - pulled : 0n;
}

// ---------------------------------------------------------------------------------------------
// Repay plans
// ---------------------------------------------------------------------------------------------

export interface CoreRepayPlan {
  /** `amount` argument of Pool.repay. */
  amountArg: bigint;
  /** Allowance to request from the Pool before the repay. */
  approve: bigint;
  /** The asset value the approval is based on (current debt for a full repay). */
  assetValue: bigint;
  full: boolean;
}

/**
 * Core (Aave) repay. A full repay (input >= current debt) sends the entire-debt sentinel so no dust
 * remains, and approves the buffered current debt; a partial repay sends `input` and approves the
 * buffered `input`.
 */
export function planCoreRepay(params: { input: bigint; debt: bigint }): CoreRepayPlan {
  const { input, debt } = params;
  if (input <= 0n) throw new RangeError("repay amount must be > 0");
  if (debt > 0n && input >= debt) {
    return { amountArg: AAVE_ENTIRE_BALANCE, approve: repayApproval(debt), assetValue: debt, full: true };
  }
  return { amountArg: input, approve: repayApproval(input), assetValue: input, full: false };
}

export interface IsolatedRepayPlan {
  /** `_shares` argument of LightlendPair.repayAsset. */
  shares: bigint;
  approve: bigint;
  assetValue: bigint;
  full: boolean;
}

/**
 * Isolated (FraxLend) repay is share-based: the pair pulls `toAmount(shares, roundUp)` after
 * accruing interest in the repay block. `shareValue` is `toBorrowAmount(shares, true, true)` read
 * for the shares chosen here (all borrow shares for a full repay).
 */
export function planIsolatedRepay(params: {
  full: boolean;
  borrowedShares: bigint;
  sharesForInput: bigint;
  shareValue: bigint;
}): IsolatedRepayPlan {
  const shares = params.full ? params.borrowedShares : params.sharesForInput;
  if (shares <= 0n) throw new RangeError("no shares to repay");
  return { shares, approve: repayApproval(params.shareValue), assetValue: params.shareValue, full: params.full };
}

// ---------------------------------------------------------------------------------------------
// Accrual models for the spec §6.1 FE criterion (approve at block N, repay at block N + k)
// ---------------------------------------------------------------------------------------------

export const RAY = 10n ** 27n;
export const SECONDS_PER_YEAR = 365n * 24n * 3600n;

const rayMul = (a: bigint, b: bigint) => (a * b + RAY / 2n) / RAY;

/**
 * Aave v3 `MathUtils.calculateCompoundedInterest` (3-term binomial expansion), in ray.
 * `annualRateRay` is the variable borrow rate (ray, per year), `seconds` the time elapsed.
 */
export function aaveCompoundedInterest(annualRateRay: bigint, seconds: bigint): bigint {
  if (seconds === 0n) return RAY;
  const expMinusOne = seconds - 1n;
  const expMinusTwo = seconds > 2n ? seconds - 2n : 0n;
  const basePowerTwo = rayMul(annualRateRay, annualRateRay) / (SECONDS_PER_YEAR * SECONDS_PER_YEAR);
  const basePowerThree = rayMul(basePowerTwo, annualRateRay) / SECONDS_PER_YEAR;
  const secondTerm = (seconds * expMinusOne * basePowerTwo) / 2n;
  const thirdTerm = (seconds * expMinusOne * expMinusTwo * basePowerThree) / 6n;
  return RAY + (annualRateRay * seconds) / SECONDS_PER_YEAR + secondTerm + thirdTerm;
}

/**
 * Core debt after `seconds` at `annualRateRay`, from a scaled balance and the current variable
 * borrow index (debt = scaled ⊗ index, rounded half-up like Aave's rayMul).
 */
export function aaveDebtAfter(scaledDebt: bigint, index: bigint, annualRateRay: bigint, seconds: bigint): bigint {
  const nextIndex = rayMul(index, aaveCompoundedInterest(annualRateRay, seconds));
  return rayMul(scaledDebt, nextIndex);
}

export const FRAXLEND_RATE_PRECISION = 10n ** 18n;

/** FraxLend VaultAccount.toAmount(shares, roundUp = true). */
export function sharesToAmountUp(shares: bigint, totalAmount: bigint, totalShares: bigint): bigint {
  if (totalShares === 0n) return shares;
  const amount = (shares * totalAmount) / totalShares;
  return (amount * totalShares) / totalAmount < shares ? amount + 1n : amount;
}

/**
 * Isolated pair total borrow after `seconds` at `ratePerSec` (1e18 precision). FraxLend accrues
 * `seconds × amount × rate / 1e18`; rounding up here over-approximates the debt (conservative).
 */
export function isolatedTotalBorrowAfter(totalBorrowAmount: bigint, ratePerSec: bigint, seconds: bigint): bigint {
  const numerator = seconds * totalBorrowAmount * ratePerSec;
  const interest = (numerator + FRAXLEND_RATE_PRECISION - 1n) / FRAXLEND_RATE_PRECISION;
  return totalBorrowAmount + interest;
}

/** The spec §6.1 check: does an allowance of `approved` cover a pull of `pulledAtRepay`? */
export function coversAccrual(approved: bigint, pulledAtRepay: bigint): boolean {
  return pulledAtRepay <= approved;
}
