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
