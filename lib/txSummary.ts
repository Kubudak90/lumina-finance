/**
 * Liquidation summaries (ui-usability-v1 §3.2 profile (c)): the debt repaid and the borrower's
 * remaining debt and collateral, estimated from the liquidator's inputs. Pure bigint; every
 * divisor is guarded and a missing input gives undefined ("unavailable"), never 0.
 */
import { EXCHANGE_PRECISION } from "./borrowMax";
import { percentMul } from "./liquidation";

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const sub0 = (a: bigint, b: bigint) => (a > b ? a - b : 0n);
const pow10 = (decimals: number) => 10n ** BigInt(decimals);

export interface LiquidationEstimate {
  repaid: bigint | undefined;
  debtAfter: bigint | undefined;
  collateralAfter: bigint | undefined;
  /** The whole collateral is taken (Aave: the collateral cap binds; pair: the clean path). */
  collateralExhausted: boolean;
}

/**
 * Aave v3.2 `liquidationCall(debtToCover)`: the pool repays min(debtToCover, maxDebtToCover) and
 * seizes its value in the collateral asset times the liquidation bonus (LiquidationLogic
 * `_calculateAvailableCollateralToLiquidate`, half-up percentMul), at most the collateral balance.
 */
export function coreLiquidationEstimate(p: {
  amount: bigint;
  maxDebtToCover: bigint;
  debt: bigint | undefined;
  collateral: bigint | undefined;
  debtPrice: bigint | undefined;
  collateralPrice: bigint | undefined;
  debtDecimals: number;
  collateralDecimals: number;
  /** 10000 + bonus, as the reserve config stores it. */
  liquidationBonus: bigint | undefined;
}): LiquidationEstimate {
  const repaid = p.debt === undefined ? undefined : min(min(p.amount, p.maxDebtToCover), p.debt);
  const debtAfter = repaid === undefined || p.debt === undefined ? undefined : p.debt - repaid;
  if (
    repaid === undefined ||
    p.collateral === undefined ||
    p.debtPrice === undefined ||
    p.collateralPrice === undefined ||
    p.collateralPrice <= 0n ||
    p.liquidationBonus === undefined
  ) {
    return { repaid, debtAfter, collateralAfter: undefined, collateralExhausted: false };
  }
  const base = (p.debtPrice * repaid * pow10(p.collateralDecimals)) / (p.collateralPrice * pow10(p.debtDecimals));
  const seized = percentMul(base, p.liquidationBonus);
  return {
    repaid,
    debtAfter,
    collateralAfter: sub0(p.collateral, seized),
    collateralExhausted: seized >= p.collateral,
  };
}

/**
 * LightlendPair `liquidate(shares)`: the liquidator repays the shares' value; the borrower loses
 * that value in collateral at the pair's exchange rate PLUS the pair's liquidation fee, which this
 * app does not read — so the remaining collateral is an upper bound. When the value alone uses up
 * the collateral, the clean path takes all of it and writes off the rest of the debt.
 */
export function isolatedLiquidationEstimate(p: {
  /** Current value of the shares being liquidated (toBorrowAmount, previewing interest). */
  shareValue: bigint | undefined;
  debt: bigint | undefined;
  collateral: bigint | undefined;
  /** Collateral per asset × 1e18 (the pair's exchange rate). */
  exchangeRate: bigint | undefined;
}): LiquidationEstimate {
  const repaid = p.shareValue === undefined ? undefined : p.debt === undefined ? p.shareValue : min(p.shareValue, p.debt);
  if (repaid === undefined || p.collateral === undefined || p.exchangeRate === undefined || p.exchangeRate <= 0n) {
    return {
      repaid,
      debtAfter: repaid === undefined || p.debt === undefined ? undefined : p.debt - repaid,
      collateralAfter: undefined,
      collateralExhausted: false,
    };
  }
  const base = (repaid * p.exchangeRate) / EXCHANGE_PRECISION;
  if (base >= p.collateral) {
    return { repaid, debtAfter: p.debt === undefined ? undefined : 0n, collateralAfter: 0n, collateralExhausted: true };
  }
  return {
    repaid,
    debtAfter: p.debt === undefined ? undefined : p.debt - repaid,
    collateralAfter: p.collateral - base,
    collateralExhausted: false,
  };
}
