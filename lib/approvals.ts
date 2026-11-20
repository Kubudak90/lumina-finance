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

export const REPAY_HEADROOM_NUMERATOR = 10_005n;
export const REPAY_HEADROOM_DENOMINATOR = 10_000n;

/**
 * Execution headroom required AFTER the approval (Gemini r2 C1): `ceil(value × 1.0005) + 1`, half of
 * the 10 bps approval buffer. Post-approval checks of a pull that grows with accrual (core full
 * repay, isolated share repay / liquidation) require allowance and wallet ≥ this, so a few blocks of
 * interest between approve and send never force a new approval, while what is left still covers the
 * accrual until execution.
 */
export function repayHeadroom(value: bigint): bigint {
  if (value < 0n) throw new RangeError("value must be >= 0");
  return (value * REPAY_HEADROOM_NUMERATOR + REPAY_HEADROOM_DENOMINATOR - 1n) / REPAY_HEADROOM_DENOMINATOR + 1n;
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
  /** Allowance to request from the Pool before the repay (also the allowance threshold). */
  approve: bigint;
  /** The asset value the approval is based on (current debt for a full repay). */
  assetValue: bigint;
  full: boolean;
}

/**
 * Core (Aave) repay. `repayAll` is the user's "repay everything" intent (set by MAX, kept apart
 * from the amount text): it sends the entire-debt sentinel, so the pool takes the debt as of the
 * repay block and no dust remains, and approves the buffered CURRENT debt. Otherwise the typed
 * amount is sent as a finite argument (Aave pulls min(amount, debt)) and the buffered amount is
 * approved. Either way the allowance threshold is `approve` (R1-5: every repay is buffered).
 */
export function planCoreRepay(params: { input: bigint; debt: bigint; repayAll: boolean }): CoreRepayPlan {
  const { input, debt, repayAll } = params;
  if (repayAll) {
    if (debt <= 0n) throw new RangeError("no debt to repay");
    return { amountArg: AAVE_ENTIRE_BALANCE, approve: repayApproval(debt), assetValue: debt, full: true };
  }
  if (input <= 0n) throw new RangeError("repay amount must be > 0");
  const pulled = debt > 0n && input > debt ? debt : input;
  return { amountArg: input, approve: repayApproval(input), assetValue: pulled, full: false };
}

/**
 * A full core repay pulls the debt as of the repay block. The wallet must hold the execution
 * headroom over the current debt (`repayHeadroom`); otherwise a partial repay of the wallet balance
 * is offered.
 */
export function coreFullRepayFunding(wallet: bigint, debt: bigint): { fundable: true } | { fundable: false; partial: bigint } {
  if (wallet >= repayHeadroom(debt)) return { fundable: true };
  return { fundable: false, partial: wallet < debt ? wallet : debt };
}

/** A pull that grows with accrual is safe to send when allowance and wallet both hold the headroom. */
export function hasExecutionHeadroom(params: { allowance: bigint; wallet: bigint; value: bigint }): boolean {
  const need = repayHeadroom(params.value);
  return params.allowance >= need && params.wallet >= need;
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

/** VaultAccountingLibrary offsets (lumina-isolated contracts/libraries/VaultAccount.sol). */
export const VAULT_VIRTUAL_SHARES = 1_000n;
export const VAULT_VIRTUAL_AMOUNT = 1_000n;

export interface VaultTotals {
  amount: bigint;
  shares: bigint;
}

/** VaultAccountingLibrary.toAmount, with the virtual offsets and the same rounding. */
export function vaultToAmount(total: VaultTotals, shares: bigint, roundUp: boolean): bigint {
  const totalAmount = total.amount + VAULT_VIRTUAL_AMOUNT;
  const totalShares = total.shares + VAULT_VIRTUAL_SHARES;
  let amount = (shares * totalAmount) / totalShares;
  if (roundUp && (amount * totalShares) / totalAmount < shares) amount += 1n;
  return amount;
}

/** VaultAccountingLibrary.toShares, with the virtual offsets and the same rounding. */
export function vaultToShares(total: VaultTotals, amount: bigint, roundUp: boolean): bigint {
  const totalAmount = total.amount + VAULT_VIRTUAL_AMOUNT;
  const totalShares = total.shares + VAULT_VIRTUAL_SHARES;
  let shares = (amount * totalShares) / totalAmount;
  if (roundUp && (shares * totalAmount) / totalShares < amount) shares += 1n;
  return shares;
}

/**
 * Isolated pair total borrow after `seconds` at `ratePerSec` (1e18 precision).
 * LightlendPairCore._calculateInterest: interest = (dt × amount × rate + remainder) / 1e18 with a
 * carried remainder < 1e18 (ISO-09); the worst case remainder (1e18 − 1) is used here, which
 * over-approximates the debt (conservative for the approval check).
 */
export function isolatedTotalBorrowAfter(totalBorrowAmount: bigint, ratePerSec: bigint, seconds: bigint): bigint {
  const numerator = seconds * totalBorrowAmount * ratePerSec + (FRAXLEND_RATE_PRECISION - 1n);
  return totalBorrowAmount + numerator / FRAXLEND_RATE_PRECISION;
}

/**
 * The largest share count whose CURRENT value, with execution headroom, fits in `wallet`, using the
 * contract's rounding (VaultAccount with the previewed totals, as toBorrowShares/toBorrowAmount do).
 * Capped at the user's borrow shares; 0 if nothing fits.
 */
export function walletBoundedShares(wallet: bigint, totals: VaultTotals, borrowedShares: bigint): bigint {
  if (wallet <= 1n || borrowedShares <= 0n) return 0n;
  // Largest v with ceil(v × 1.0005) + 1 <= wallet.
  const target = ((wallet - 1n) * REPAY_HEADROOM_DENOMINATOR) / REPAY_HEADROOM_NUMERATOR;
  let shares = vaultToShares(totals, target, false);
  if (shares > borrowedShares) shares = borrowedShares;
  while (shares > 0n && repayHeadroom(vaultToAmount(totals, shares, true)) > wallet) shares -= 1n;
  return shares;
}

/** The spec §6.1 check: does an allowance of `approved` cover a pull of `pulledAtRepay`? */
export function coversAccrual(approved: bigint, pulledAtRepay: bigint): boolean {
  return pulledAtRepay <= approved;
}
