/**
 * Liquidation summaries (ui-usability-v1 §3.2 profile (c)): the debt repaid and the borrower's
 * remaining debt and collateral, estimated from the liquidator's inputs. Pure bigint; every
 * divisor is guarded and a missing input gives undefined ("unavailable"), never 0.
 */
import { vaultToAmount, type VaultTotals } from "./approvals";
import { percentMul, repaymentExceedsCollateral, simulateIsolatedLiquidation } from "./liquidation";

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

export interface IsolatedLiquidationEstimate extends LiquidationEstimate {
  /** Gross collateral taken from the borrower (`collateralReceived + protocolFee`). */
  collateralSeized: bigint | undefined;
  /** Protocol share of the liquidation bonus (ISO-01: bonus only). */
  protocolFee: bigint | undefined;
  /** Net collateral delivered to the liquidator (`collateralSeized − protocolFee`). */
  collateralReceived: bigint | undefined;
  /** Bad debt written off against lenders (clean path, unpaid shares only). */
  writeOff: bigint | undefined;
  /** True when the quote-time repayment exceeds the value of the collateral received. */
  repaymentExceedsCollateral: boolean;
  /** True when the pair takes the clean path (all collateral taken, remaining shares written off). */
  isClean: boolean;
}

/**
 * LightlendPair `liquidate(shares)`: exact reproduction of `LightlendPairCore.liquidate` integer
 * arithmetic (branch rounds down, repayment rounds up, protocol fee on bonus only, clean-path
 * write-off on unpaid shares only). Any missing input produces `undefined` ("unavailable"), never 0.
 */
export function isolatedLiquidationEstimate(p: {
  shares: bigint;
  borrowerShares: bigint;
  totalBorrow: VaultTotals | undefined;
  debt: bigint | undefined;
  collateral: bigint | undefined;
  /** Collateral per asset × 1e18 (the pair's liquidation exchange rate, `lowExchangeRate`). */
  exchangeRate: bigint | undefined;
  cleanLiquidationFee: bigint | undefined;
  dirtyLiquidationFee: bigint | undefined;
  protocolLiquidationFee: bigint | undefined;
}): IsolatedLiquidationEstimate {
  const unavailable: IsolatedLiquidationEstimate = {
    repaid: undefined,
    debtAfter: undefined,
    collateralAfter: undefined,
    collateralExhausted: false,
    collateralSeized: undefined,
    protocolFee: undefined,
    collateralReceived: undefined,
    writeOff: undefined,
    repaymentExceedsCollateral: false,
    isClean: false,
  };
  if (p.shares <= 0n || p.borrowerShares <= 0n || p.totalBorrow === undefined) {
    return unavailable;
  }
  const effectiveShares = min(p.shares, p.borrowerShares);
  const repaid = vaultToAmount(p.totalBorrow, effectiveShares, true);

  if (
    p.collateral === undefined ||
    p.exchangeRate === undefined ||
    p.exchangeRate <= 0n ||
    p.cleanLiquidationFee === undefined ||
    p.dirtyLiquidationFee === undefined ||
    p.protocolLiquidationFee === undefined
  ) {
    return { ...unavailable, repaid };
  }

  const sim = simulateIsolatedLiquidation(
    {
      borrowerShares: p.borrowerShares,
      collateral: p.collateral,
      totalBorrow: p.totalBorrow,
      exchangeRate: p.exchangeRate,
      cleanLiquidationFee: p.cleanLiquidationFee,
      dirtyLiquidationFee: p.dirtyLiquidationFee,
      protocolLiquidationFee: p.protocolLiquidationFee,
    },
    effectiveShares,
  );

  const remainingShares = p.borrowerShares - effectiveShares;
  const debtAfter =
    sim.isClean || remainingShares === 0n
      ? 0n
      : vaultToAmount(
          {
            amount: sub0(p.totalBorrow.amount, sim.repayment),
            shares: sub0(p.totalBorrow.shares, effectiveShares),
          },
          remainingShares,
          true,
        );

  return {
    repaid: sim.repayment,
    debtAfter,
    collateralAfter: sub0(p.collateral, sim.collateralSeized),
    collateralExhausted: sim.isClean,
    collateralSeized: sim.collateralSeized,
    protocolFee: sim.protocolFee,
    collateralReceived: sim.collateralReceived,
    writeOff: sim.writeOff,
    repaymentExceedsCollateral: repaymentExceedsCollateral(sim, p.exchangeRate),
    isClean: sim.isClean,
  };
}
