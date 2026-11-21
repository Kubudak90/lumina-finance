/**
 * Risk maths for both venues (ui-usability-v1 spec §3.1). Pure, bigint, no React.
 *
 * Core (Aave v3.2): the account data is recomputed per reserve from one snapshot, mirroring
 * lumina-core `GenericLogic.calculateUserAccountData` (base-currency values floored per reserve,
 * `avgLtv` / `avgLiquidationThreshold` floored to integer bps, HF = wadDiv(percentMul(collateral,
 * avgLT), debt) with Aave's half-up rounding, `type(uint256).max` without debt). An action changes
 * the snapshot, never the `getUserAccountData` aggregates, so before and after come from the same
 * reads and a price read at another block cannot create phantom collateral.
 *
 * Isolated (FraxLend pair): LTV as `_isSolvent` computes it (1e5 precision, at the dual oracle's
 * `priceHigh`), after-states with clamps (never a negative amount), and a liquidation price that
 * depends only on debt, collateral and maxLTV.
 *
 * Every divisor is guarded: no function here divides a bigint by zero. A missing read is
 * "unavailable", never zero (FE-07). Floats appear only in display values (gauge fill).
 */
import Decimal from "decimal.js";
import { BPS, LTV_PRECISION, isolatedLtv } from "./borrowMax";
import { MAX_HEALTH_FACTOR } from "./format";
import { percentMul } from "./liquidation";
import { SECONDS_PER_YEAR, vaultToAmount, vaultToShares, type VaultTotals } from "./approvals";

export { MAX_HEALTH_FACTOR };

export const WAD = 10n ** 18n;
/** Liquidation prices are quoted with 8 decimals (the AaveOracle base-currency scale). */
export const PRICE_DECIMALS = 8;
const PRICE_UNIT = 10n ** BigInt(PRICE_DECIMALS);
/** v1 market set (spec §4): the liquidation-price formulas assume exactly these two assets. */
export const VOLATILE_SYMBOL = "WETH";
export const STABLE_SYMBOL = "USDC";

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const sub0 = (a: bigint, b: bigint) => (a > b ? a - b : 0n);
const pow10 = (decimals: number) => 10n ** BigInt(decimals);

/** WadRayMath.wadDiv (half up). Callers guarantee b > 0. */
export function wadDiv(a: bigint, b: bigint): bigint {
  return (a * WAD + b / 2n) / b;
}

// =============================================================================================
// Shared result types
// =============================================================================================

export type UnavailableReason =
  /** The user is in an eMode category: its LT / LTV are not loaded (spec §3.1, r2 #4). */
  | "emode"
  /** The user holds a reserve outside the loaded configs / the v1 market set. */
  | "unknown-reserve"
  /** A read the result depends on failed or is still loading. */
  | "missing-input";

export interface Unavailable {
  available: false;
  reason: UnavailableReason;
}

const unavailable = (reason: UnavailableReason): Unavailable => ({ available: false, reason });

/**
 * Price of ETH (USDC or USD per WETH, 8 decimals) at which the position becomes liquidatable.
 * - "below" / "above": liquidatable once the price is strictly below / above `price`;
 * - "now": liquidatable at every price; "none": at no price (or no debt).
 */
export type LiquidationPrice =
  | { kind: "none" }
  | { kind: "now" }
  | { kind: "below"; price: bigint }
  | { kind: "above"; price: bigint }
  | { kind: "unavailable"; reason: UnavailableReason };

// =============================================================================================
// Core (Aave v3.2)
// =============================================================================================

export interface CoreReserve {
  asset: string;
  symbol: string;
  decimals: number;
  /** Reserve config LTV and liquidation threshold (bps); undefined when the config is not loaded. */
  ltv: bigint | undefined;
  liquidationThreshold: bigint | undefined;
  /** AaveOracle.getAssetPrice (base currency, 8 decimals); undefined when unreadable. */
  price: bigint | undefined;
  /** aToken balance (interest included). */
  supplied: bigint | undefined;
  /** Variable debt balance (interest included). */
  borrowed: bigint | undefined;
  /** getUserReserveData().usageAsCollateralEnabled. */
  collateralEnabled: boolean | undefined;
}

export interface CoreSnapshot {
  /** Pool.getUserEMode(user); undefined when unreadable. */
  eMode: bigint | undefined;
  reserves: readonly CoreReserve[];
}

export interface CoreAccountData {
  available: true;
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  availableBorrowsBase: bigint;
  /** Σ(value × ltv) / collateral, floored to integer bps. */
  avgLtv: bigint;
  /** Σ(value × LT) / collateral, floored to integer bps. */
  avgLiquidationThreshold: bigint;
  /** WAD; MAX_HEALTH_FACTOR without debt. */
  healthFactor: bigint;
  hasZeroLtvCollateral: boolean;
}

/** Whether the reserve's balance counts as collateral (GenericLogic: flag on and LT ≠ 0). */
function countsAsCollateral(r: CoreReserve): boolean {
  return r.collateralEnabled === true && r.liquidationThreshold !== undefined && r.liquidationThreshold !== 0n;
}

/**
 * `GenericLogic.calculateUserAccountData`, per reserve, from one snapshot. "unavailable" when the
 * user is in an eMode category (or it is unknown), holds a reserve without a loaded config, or a
 * balance, flag or price it depends on is missing.
 */
export function accountData(snapshot: CoreSnapshot): CoreAccountData | Unavailable {
  if (snapshot.eMode === undefined) return unavailable("missing-input");
  if (snapshot.eMode !== 0n) return unavailable("emode");

  let totalCollateral = 0n;
  let totalDebt = 0n;
  let ltvSum = 0n;
  let ltSum = 0n;
  let hasZeroLtvCollateral = false;

  for (const r of snapshot.reserves) {
    if (r.supplied === undefined || r.borrowed === undefined) return unavailable("missing-input");
    // GenericLogic skips reserves the user neither supplies as collateral nor borrows.
    if (r.supplied <= 0n && r.borrowed <= 0n) continue;
    if (r.ltv === undefined || r.liquidationThreshold === undefined) return unavailable("unknown-reserve");
    if (r.supplied > 0n && r.collateralEnabled === undefined) return unavailable("missing-input");
    const collateral = r.supplied > 0n && countsAsCollateral(r);
    if (!collateral && r.borrowed <= 0n) continue;
    if (r.price === undefined || r.price <= 0n) return unavailable("missing-input");

    const unit = pow10(r.decimals);
    if (collateral) {
      const value = (r.supplied * r.price) / unit;
      totalCollateral += value;
      if (r.ltv !== 0n) ltvSum += value * r.ltv;
      else hasZeroLtvCollateral = true;
      ltSum += value * r.liquidationThreshold;
    }
    if (r.borrowed > 0n) totalDebt += (r.borrowed * r.price) / unit;
  }

  const avgLtv = totalCollateral !== 0n ? ltvSum / totalCollateral : 0n;
  const avgLiquidationThreshold = totalCollateral !== 0n ? ltSum / totalCollateral : 0n;
  const healthFactor =
    totalDebt === 0n ? MAX_HEALTH_FACTOR : wadDiv(percentMul(totalCollateral, avgLiquidationThreshold), totalDebt);
  // GenericLogic.calculateAvailableBorrows.
  const capacity = percentMul(totalCollateral, avgLtv);
  return {
    available: true,
    totalCollateralBase: totalCollateral,
    totalDebtBase: totalDebt,
    availableBorrowsBase: sub0(capacity, totalDebt),
    avgLtv,
    avgLiquidationThreshold,
    healthFactor,
    hasZeroLtvCollateral,
  };
}

/**
 * Debt ÷ (collateral × avgLtv), WAD (1e18 = 100%; may exceed it). 0 without debt; "over" (over
 * 100%) with debt and no borrowing capacity at all.
 */
export type BorrowLimitUsed = { kind: "ratio"; wad: bigint } | { kind: "over" };

export function borrowLimitUsed(data: CoreAccountData): BorrowLimitUsed {
  if (data.totalDebtBase === 0n) return { kind: "ratio", wad: 0n };
  const capacityBps = data.totalCollateralBase * data.avgLtv;
  if (capacityBps === 0n) return { kind: "over" };
  return { kind: "ratio", wad: (data.totalDebtBase * BPS * WAD) / capacityBps };
}

/**
 * The ETH price (USD, 8 decimals) at which HF reaches 1, with only the WETH price varying (spec
 * §3.1). With collateral-enabled balances C, debts D and thresholds LT:
 *   A = C_weth·LT_weth − D_weth  (WETH)      B = D_usdc·P_usdc − C_usdc·P_usdc·LT_usdc  (USD)
 * HF < 1 ⇔ p·A < B, so p* = B / A and the sign partition below is complete.
 */
export function coreLiquidationPrice(snapshot: CoreSnapshot, data: CoreAccountData): LiquidationPrice {
  if (data.totalDebtBase === 0n) return { kind: "none" };
  let weth: CoreReserve | undefined;
  let usdc: CoreReserve | undefined;
  for (const r of snapshot.reserves) {
    if (r.symbol === VOLATILE_SYMBOL) weth = r;
    else if (r.symbol === STABLE_SYMBOL) usdc = r;
    else if ((r.supplied ?? 0n) > 0n || (r.borrowed ?? 0n) > 0n) return { kind: "unavailable", reason: "unknown-reserve" };
  }
  // A in wei·bps; B in (USDC base units)·bps·price8. accountData() already required every held
  // reserve's config and, where it matters, its price.
  const cw = weth && (weth.supplied ?? 0n) > 0n && countsAsCollateral(weth) ? weth.supplied! : 0n;
  const dw = weth?.borrowed ?? 0n;
  const A = cw * (weth?.liquidationThreshold ?? 0n) - dw * BPS;
  const cu = usdc && (usdc.supplied ?? 0n) > 0n && countsAsCollateral(usdc) ? usdc.supplied! : 0n;
  const du = usdc?.borrowed ?? 0n;
  let B = 0n;
  if (cu > 0n || du > 0n) {
    if (usdc?.price === undefined || usdc.price <= 0n) return { kind: "unavailable", reason: "missing-input" };
    B = usdc.price * (du * BPS - cu * (usdc.liquidationThreshold ?? 0n));
  }

  if ((A < 0n && B >= 0n) || (A === 0n && B > 0n)) return { kind: "now" };
  if (A >= 0n && B <= 0n) return { kind: "none" };
  // p·A / 10^dw < B / 10^du  →  p* = B·10^dw / (A·10^du); A ≠ 0 here and both have one sign.
  const num = (B < 0n ? -B : B) * pow10(weth!.decimals);
  const den = (A < 0n ? -A : A) * pow10(usdc?.decimals ?? 0);
  const price = num / den;
  return A > 0n ? { kind: "below", price } : { kind: "above", price };
}

export interface CoreRisk extends CoreAccountData {
  borrowLimitUsed: BorrowLimitUsed;
  liquidationPrice: LiquidationPrice;
}

/** Account data plus the derived risk figures; "unavailable" covers HF, borrow limit and price. */
export function coreRisk(snapshot: CoreSnapshot): CoreRisk | Unavailable {
  const data = accountData(snapshot);
  if (!data.available) return data;
  return { ...data, borrowLimitUsed: borrowLimitUsed(data), liquidationPrice: coreLiquidationPrice(snapshot, data) };
}

export type CoreAction =
  | { kind: "supply"; asset: string; amount: bigint }
  | { kind: "withdraw"; asset: string; amount: bigint | "all" }
  | { kind: "borrow"; asset: string; amount: bigint }
  | { kind: "repay"; asset: string; amount: bigint | "all" }
  | { kind: "setCollateral"; asset: string; enabled: boolean };

export interface CoreActionResult {
  /** The snapshot after the action; undefined when the asset is not in the snapshot. */
  snapshot: CoreSnapshot | undefined;
  /** The amount is more than the action can use (withdraw over balance): shown, marked invalid. */
  invalid: boolean;
  /** The amount was reduced to what the action applies (withdraw / repay over the balance). */
  clamped: boolean;
}

const sameAsset = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The snapshot after one action, per asset, with Aave's clamps and its first-supply auto-enable. */
export function applyCoreAction(snapshot: CoreSnapshot, action: CoreAction): CoreActionResult {
  const index = snapshot.reserves.findIndex((r) => sameAsset(r.asset, action.asset));
  if (index < 0) return { snapshot: undefined, invalid: false, clamped: false };
  const r = snapshot.reserves[index];
  let next: CoreReserve = r;
  let invalid = false;
  let clamped = false;
  const amountOf = (a: bigint | "all", held: bigint) => {
    if (a === "all") return held;
    if (a < 0n) {
      invalid = true;
      return 0n;
    }
    return a;
  };

  switch (action.kind) {
    case "supply": {
      const x = amountOf(action.amount, 0n);
      if (r.supplied === undefined) break;
      let collateralEnabled = r.collateralEnabled;
      // SupplyLogic: the first supply (aToken balance 0) enables collateral when the reserve LTV > 0.
      if (x > 0n && r.supplied === 0n && collateralEnabled !== true) {
        collateralEnabled = r.ltv === undefined ? undefined : r.ltv > 0n;
      }
      next = { ...r, supplied: r.supplied + x, collateralEnabled };
      break;
    }
    case "withdraw": {
      if (r.supplied === undefined) break;
      const x = amountOf(action.amount, r.supplied);
      if (x > r.supplied) {
        invalid = true;
        clamped = true;
      }
      const remaining = r.supplied - min(x, r.supplied);
      // SupplyLogic.executeWithdraw clears the collateral flag when the whole balance leaves.
      next = { ...r, supplied: remaining, collateralEnabled: remaining === 0n && r.supplied > 0n ? false : r.collateralEnabled };
      break;
    }
    case "borrow": {
      const x = amountOf(action.amount, 0n);
      next = { ...r, borrowed: r.borrowed === undefined ? undefined : r.borrowed + x };
      break;
    }
    case "repay": {
      if (r.borrowed === undefined) break;
      const x = amountOf(action.amount, r.borrowed);
      // The pool pulls min(amount, debt) of this asset only (r1 #6).
      if (x > r.borrowed) clamped = true;
      next = { ...r, borrowed: r.borrowed - min(x, r.borrowed) };
      break;
    }
    case "setCollateral":
      next = { ...r, collateralEnabled: action.enabled };
      break;
  }
  const reserves = snapshot.reserves.slice();
  reserves[index] = next;
  return { snapshot: { eMode: snapshot.eMode, reserves }, invalid, clamped };
}

export interface CorePreview {
  before: CoreRisk | Unavailable;
  after: CoreRisk | Unavailable;
  invalid: boolean;
  clamped: boolean;
}

/** Before and after of one action, both from the same snapshot. */
export function corePreview(snapshot: CoreSnapshot, action: CoreAction): CorePreview {
  const applied = applyCoreAction(snapshot, action);
  return {
    before: coreRisk(snapshot),
    after: applied.snapshot ? coreRisk(applied.snapshot) : unavailable("unknown-reserve"),
    invalid: applied.invalid,
    clamped: applied.clamped,
  };
}

/** Hook-shaped inputs → snapshot (positions from useUserPosition, configs from useAllMarkets). */
export function buildCoreSnapshot(params: {
  eMode: bigint | undefined;
  positions: readonly {
    asset: string;
    symbol: string;
    decimals: number;
    supplied: bigint | undefined;
    borrowed: bigint | undefined;
    collateralEnabled: boolean | undefined;
  }[];
  configOf: (asset: string) => { ltv: number | bigint; liquidationThreshold: number | bigint } | undefined;
  priceOf: (asset: string) => bigint | undefined;
}): CoreSnapshot {
  return {
    eMode: params.eMode,
    reserves: params.positions.map((p) => {
      const cfg = params.configOf(p.asset);
      return {
        asset: p.asset,
        symbol: p.symbol,
        decimals: p.decimals,
        ltv: cfg ? BigInt(cfg.ltv) : undefined,
        liquidationThreshold: cfg ? BigInt(cfg.liquidationThreshold) : undefined,
        price: params.priceOf(p.asset),
        supplied: p.supplied,
        borrowed: p.borrowed,
        collateralEnabled: p.collateralEnabled,
      };
    }),
  };
}

// =============================================================================================
// Isolated (FraxLend pair)
// =============================================================================================

export interface IsolatedState {
  /** Debt in asset units: toBorrowAmount(userBorrowShares, roundUp, previewInterest). */
  debt: bigint | undefined;
  borrowedShares: bigint | undefined;
  collateral: bigint | undefined;
  /** pair.maxLTV() (1e5 = 100%). */
  maxLTV: bigint | undefined;
  /** R: the dual oracle's priceHigh (what `_isSolvent` uses); collateral per asset × 1e18. */
  exchangeRate: bigint | undefined;
  /** Dual oracle bad-data flag (borrows blocked); shown as a "price data stale" marker. */
  isBadData: boolean | undefined;
  /** The previewed totalBorrow (getPairAccounting / previewAddInterest). */
  totalBorrow: VaultTotals | undefined;
}

/** Which side of a pair is ETH, for the liquidation-price direction. */
export interface IsolatedMarketSides {
  assetSymbol: string;
  collateralSymbol: string;
  assetDecimals: number;
  collateralDecimals: number;
}

export type IsolatedAction =
  | { kind: "borrow"; amount: bigint; collateral?: bigint }
  | { kind: "repay"; amount: bigint }
  | { kind: "repayShares"; shares: bigint | "all" }
  | { kind: "addCollateral"; amount: bigint }
  | { kind: "removeCollateral"; amount: bigint };

export interface IsolatedActionResult {
  state: IsolatedState;
  /** Over-amount (repay over debt or shares, remove over collateral): clamped, marked invalid. */
  invalid: boolean;
}

const plus = (a: bigint | undefined, b: bigint) => (a === undefined ? undefined : a + b);

/** The position after one action. Every subtraction is clamped at 0 and flags an over-amount. */
export function applyIsolatedAction(state: IsolatedState, action: IsolatedAction): IsolatedActionResult {
  let invalid = false;
  const nonNeg = (x: bigint) => {
    if (x < 0n) {
      invalid = true;
      return 0n;
    }
    return x;
  };
  const tb = state.totalBorrow;
  const bs = state.borrowedShares;

  switch (action.kind) {
    case "borrow": {
      const x = nonNeg(action.amount);
      const added = nonNeg(action.collateral ?? 0n);
      // _borrowAsset mints toShares(amount, roundUp = true).
      const newShares = tb ? vaultToShares(tb, x, true) : undefined;
      return {
        state: {
          ...state,
          debt: plus(state.debt, x),
          collateral: plus(state.collateral, added),
          borrowedShares: bs === undefined || newShares === undefined ? undefined : bs + newShares,
          totalBorrow: tb && newShares !== undefined ? { amount: tb.amount + x, shares: tb.shares + newShares } : undefined,
        },
        invalid,
      };
    }
    case "repay": {
      const x = nonNeg(action.amount);
      if (state.debt === undefined) return { state: { ...state, borrowedShares: undefined, totalBorrow: undefined }, invalid };
      if (x > state.debt) invalid = true;
      const repaid = min(x, state.debt);
      const debt = state.debt - repaid;
      if (tb === undefined || bs === undefined) return { state: { ...state, debt, borrowedShares: undefined, totalBorrow: undefined }, invalid };
      const shares = debt === 0n ? bs : min(vaultToShares(tb, repaid, false), bs);
      return { state: { ...state, debt, ...afterShareRepay(tb, bs, shares) }, invalid };
    }
    case "repayShares": {
      if (bs === undefined) return { state: { ...state, debt: undefined, borrowedShares: undefined, totalBorrow: undefined }, invalid };
      const wanted = action.shares === "all" ? bs : nonNeg(action.shares);
      if (wanted > bs) invalid = true;
      const shares = min(wanted, bs);
      if (shares === bs) return { state: { ...state, debt: 0n, ...(tb ? afterShareRepay(tb, bs, shares) : { borrowedShares: 0n, totalBorrow: undefined }) }, invalid };
      // Remaining shares at the previewed post-repay totalBorrow (no extra read, r2 #5).
      if (tb === undefined) return { state: { ...state, debt: undefined, borrowedShares: bs - shares, totalBorrow: undefined }, invalid };
      const after = afterShareRepay(tb, bs, shares);
      return { state: { ...state, debt: vaultToAmount(after.totalBorrow, after.borrowedShares, true), ...after }, invalid };
    }
    case "addCollateral":
      return { state: { ...state, collateral: plus(state.collateral, nonNeg(action.amount)) }, invalid };
    case "removeCollateral": {
      const x = nonNeg(action.amount);
      if (state.collateral === undefined) return { state, invalid };
      if (x > state.collateral) invalid = true;
      return { state: { ...state, collateral: sub0(state.collateral, x) }, invalid };
    }
  }
}

/**
 * `repayAsset(shares)` on the totals: the pair pulls toAmount(shares, roundUp) and writes off any
 * residual amount once the last share is gone (LightlendPairCore._repayAsset).
 */
function afterShareRepay(tb: VaultTotals, borrowedShares: bigint, shares: bigint) {
  const pulled = vaultToAmount(tb, shares, true);
  const total = { amount: sub0(tb.amount, pulled), shares: sub0(tb.shares, shares) };
  if (total.shares === 0n) total.amount = 0n;
  return { borrowedShares: sub0(borrowedShares, shares), totalBorrow: total };
}

/** LTV in 1e5 units, ∞ for debt without collateral or maxLTV, or unavailable. */
export type IsolatedLtvResult =
  | { kind: "value"; ltv: bigint }
  | { kind: "infinite" }
  | { kind: "unavailable"; reason: UnavailableReason };

/**
 * Boundaries (spec §3.1): debt 0 → 0% (even without collateral); debt with zero collateral or
 * maxLTV → ∞ (independent of R, as `_isSolvent`); otherwise `isolatedLtv`, which needs R > 0.
 */
export function isolatedLtvOf(p: Pick<IsolatedState, "debt" | "collateral" | "maxLTV" | "exchangeRate">): IsolatedLtvResult {
  if (p.debt === undefined || p.collateral === undefined) return { kind: "unavailable", reason: "missing-input" };
  if (p.debt === 0n) return { kind: "value", ltv: 0n };
  if (p.collateral === 0n || p.maxLTV === 0n) return { kind: "infinite" };
  if (p.exchangeRate === undefined || p.exchangeRate <= 0n) return { kind: "unavailable", reason: "missing-input" };
  return { kind: "value", ltv: isolatedLtv(p.debt, p.collateral, p.exchangeRate)! };
}

/**
 * ETH price (USDC per WETH, 8 decimals) at which the pair position becomes insolvent. It depends
 * only on debt, collateral and maxLTV, never on R or isBadData (r1 #8.2):
 * - asset USDC, collateral WETH: below debt / (collateral × maxLTV);
 * - asset WETH, collateral USDC: above collateral × maxLTV / debt.
 */
export function isolatedLiquidationPrice(
  p: Pick<IsolatedState, "debt" | "collateral" | "maxLTV">,
  sides: IsolatedMarketSides,
): LiquidationPrice {
  const { debt, collateral, maxLTV } = p;
  if (debt === undefined || collateral === undefined || maxLTV === undefined) return { kind: "unavailable", reason: "missing-input" };
  if (debt === 0n) return { kind: "none" };
  if (collateral === 0n || maxLTV === 0n) return { kind: "now" };
  const dA = pow10(sides.assetDecimals);
  const dC = pow10(sides.collateralDecimals);
  if (sides.collateralSymbol === VOLATILE_SYMBOL && sides.assetSymbol === STABLE_SYMBOL) {
    return { kind: "below", price: (debt * LTV_PRECISION * dC * PRICE_UNIT) / (maxLTV * collateral * dA) };
  }
  if (sides.assetSymbol === VOLATILE_SYMBOL && sides.collateralSymbol === STABLE_SYMBOL) {
    return { kind: "above", price: (collateral * maxLTV * dA * PRICE_UNIT) / (debt * LTV_PRECISION * dC) };
  }
  return { kind: "unavailable", reason: "unknown-reserve" };
}

export interface IsolatedRisk {
  debt: bigint | undefined;
  collateral: bigint | undefined;
  maxLTV: bigint | undefined;
  ltv: IsolatedLtvResult;
  liquidationPrice: LiquidationPrice;
  /** isBadData: the LTV is still shown, with a "price data stale" marker (spec §5.5). */
  stale: boolean;
}

export function isolatedRisk(state: IsolatedState, sides: IsolatedMarketSides): IsolatedRisk {
  return {
    debt: state.debt,
    collateral: state.collateral,
    maxLTV: state.maxLTV,
    ltv: isolatedLtvOf(state),
    liquidationPrice: isolatedLiquidationPrice(state, sides),
    stale: state.isBadData === true,
  };
}

export interface IsolatedPreview {
  before: IsolatedRisk;
  after: IsolatedRisk;
  afterState: IsolatedState;
  invalid: boolean;
}

export function isolatedPreview(state: IsolatedState, action: IsolatedAction, sides: IsolatedMarketSides): IsolatedPreview {
  const applied = applyIsolatedAction(state, action);
  return {
    before: isolatedRisk(state, sides),
    after: isolatedRisk(applied.state, sides),
    afterState: applied.state,
    invalid: applied.invalid,
  };
}

// =============================================================================================
// Status, gauges and formatHealth (spec §3.1)
// =============================================================================================

export type HealthStatus = "safe" | "warning" | "danger" | "liquidatable" | "unavailable";

export const HEALTH_STATUS_LABEL: Readonly<Record<HealthStatus, string>> = {
  safe: "Safe",
  warning: "Warning",
  danger: "Danger",
  liquidatable: "Liquidatable",
  unavailable: "Unavailable",
};

/** Core HF thresholds (WAD): liquidatable < 1.0, danger < 1.2, warning < 1.5. */
export const HF_THRESHOLDS = {
  liquidatable: WAD,
  danger: (12n * WAD) / 10n,
  warning: (15n * WAD) / 10n,
} as const;
/** The HF gauge spans 0–3. */
export const HF_GAUGE_MAX = 3n * WAD;

/** Isolated ltv/maxLTV thresholds as fractions: liquidatable > 1.0, danger ≥ 0.9, warning ≥ 0.8. */
export const LTV_RATIO_THRESHOLDS = {
  danger: { num: 9n, den: 10n },
  warning: { num: 8n, den: 10n },
} as const;

export type HealthInput =
  | { kind: "hf"; healthFactor: bigint | undefined }
  | { kind: "ltv"; ltv: IsolatedLtvResult | undefined; maxLTV: bigint | undefined };

export interface HealthDisplay {
  status: HealthStatus;
  /** "Safe", "Warning", … */
  statusLabel: string;
  /** "1.53", "∞", "72.50%" or "—". */
  value: string;
  /** Gauge fill in percent, 0–100 (display only): HF over 0–3, LTV over 0–100% of maxLTV. */
  gauge: number;
}

const pad2 = (v: bigint) => v.toString().padStart(2, "0");
const GAUGE_FULL_BPS = 10_000n;
const gaugePercent = (bps: bigint) => Number(bps > GAUGE_FULL_BPS ? GAUGE_FULL_BPS : bps < 0n ? 0n : bps) / 100;

/** HF (WAD) floored to two decimals, so 0.999 never reads "1.00". */
export function formatHf(hf: bigint): string {
  if (hf === MAX_HEALTH_FACTOR) return "∞";
  const cents = hf / 10n ** 16n;
  return `${cents / 100n}.${pad2(cents % 100n)}`;
}

/** LTV in 1e5 units as a percent, floored to two decimals ("72.50%"). */
export function formatLtvPercent(ltv: bigint): string {
  const hundredths = ltv / 10n; // 1e5 = 100.00% → 1e4 hundredths of a percent
  return `${hundredths / 100n}.${pad2(hundredths % 100n)}%`;
}

export function hfStatus(hf: bigint): HealthStatus {
  if (hf < HF_THRESHOLDS.liquidatable) return "liquidatable";
  if (hf < HF_THRESHOLDS.danger) return "danger";
  if (hf < HF_THRESHOLDS.warning) return "warning";
  return "safe";
}

/** Status of ltv/maxLTV, by bigint cross-multiplication (no division). */
export function ltvStatus(ltv: bigint, maxLTV: bigint): HealthStatus {
  if (ltv > maxLTV) return "liquidatable";
  if (ltv === 0n) return "safe";
  const { danger, warning } = LTV_RATIO_THRESHOLDS;
  if (ltv * danger.den >= maxLTV * danger.num) return "danger";
  if (ltv * warning.den >= maxLTV * warning.num) return "warning";
  return "safe";
}

const display = (status: HealthStatus, value: string, gauge: number): HealthDisplay => ({
  status,
  statusLabel: HEALTH_STATUS_LABEL[status],
  value,
  gauge,
});

/** The one place that turns an HF or an isolated LTV into status, text and gauge fill. */
export function formatHealth(input: HealthInput): HealthDisplay {
  if (input.kind === "hf") {
    const hf = input.healthFactor;
    if (hf === undefined) return display("unavailable", "—", 0);
    if (hf === MAX_HEALTH_FACTOR) return display("safe", "∞", 100);
    return display(hfStatus(hf), formatHf(hf), gaugePercent((hf * GAUGE_FULL_BPS) / HF_GAUGE_MAX));
  }
  const { ltv, maxLTV } = input;
  if (ltv === undefined || ltv.kind === "unavailable") return display("unavailable", "—", 0);
  if (ltv.kind === "infinite") return display("liquidatable", "∞", 100);
  if (maxLTV === undefined) return display("unavailable", formatLtvPercent(ltv.ltv), 0);
  if (ltv.ltv === 0n) return display("safe", formatLtvPercent(0n), 0);
  if (maxLTV === 0n) return display("liquidatable", formatLtvPercent(ltv.ltv), 100);
  return display(ltvStatus(ltv.ltv, maxLTV), formatLtvPercent(ltv.ltv), gaugePercent((ltv.ltv * GAUGE_FULL_BPS) / maxLTV));
}

// =============================================================================================
// Rates (spec §3.1): per-second compounding over 31,536,000 s for both venues
// =============================================================================================

/** decimal.js with enough digits for (1 + r/31,536,000)^31,536,000 at small r. */
const D = Decimal.clone({ precision: 40 });
const SECONDS = SECONDS_PER_YEAR; // 365 days, as Aave MathUtils
const RAY_DECIMAL = new D(10).pow(27);
const FRAXLEND_RATE_PRECISION = 10n ** 18n;
/** LightlendPairConstants.FEE_PRECISION. */
export const FEE_PRECISION = 100_000n;

/** A Decimal with the rate maths' precision (for sums of rate-weighted values). */
export function toDecimal(value: Decimal.Value): Decimal {
  return new D(value);
}

/** APR (a fraction, e.g. 0.05) → APY with per-second compounding. */
export function aprToApy(apr: Decimal.Value): Decimal {
  const r = new D(apr);
  if (r.isZero()) return new D(0);
  const n = new D(SECONDS.toString());
  return r.div(n).plus(1).pow(n).minus(1);
}

/** Aave ray rate (1e27 = 100% APR) → APR fraction. */
export function rayToApr(rateRay: bigint): Decimal {
  return new D(rateRay.toString()).div(RAY_DECIMAL);
}

/** Aave ray rate → APY; undefined when the rate is unavailable. */
export function coreApy(rateRay: bigint | undefined): Decimal | undefined {
  return rateRay === undefined ? undefined : aprToApy(rayToApr(rateRay));
}

export interface IsolatedRateInput {
  /** previewAddInterest()._newCurrentRateInfo.ratePerSec (1e18 per second). */
  ratePerSec: bigint | undefined;
  /** previewAddInterest()._newCurrentRateInfo.feeToProtocolRate (1e5). */
  feeToProtocolRate: bigint | undefined;
  /** Previewed totals (previewAddInterest / getPairAccounting). */
  totalAssetAmount: bigint | undefined;
  totalBorrowAmount: bigint | undefined;
  /** pair.isInterestPaused(): previewAddInterest then returns the stale pre-pause rate (r2 #1). */
  interestPaused: boolean | undefined;
}

/**
 * Isolated APRs (fractions): borrow = ratePerSec × seconds per year; lend = borrow × utilization ×
 * (1 − fee/1e5), with utilization from the previewed totals as bigint, clamped to ≤ 1. Both 0
 * while interest is paused; undefined when an input is missing.
 */
export function isolatedAprs(input: IsolatedRateInput): { borrowApr: Decimal; lendApr: Decimal } | undefined {
  const { ratePerSec, feeToProtocolRate, totalAssetAmount, totalBorrowAmount, interestPaused } = input;
  if (interestPaused === undefined) return undefined;
  if (interestPaused) return { borrowApr: new D(0), lendApr: new D(0) };
  if (ratePerSec === undefined || feeToProtocolRate === undefined || totalAssetAmount === undefined || totalBorrowAmount === undefined) {
    return undefined;
  }
  const yearly = ratePerSec * SECONDS;
  const borrowApr = new D(yearly.toString()).div(FRAXLEND_RATE_PRECISION.toString());
  if (totalAssetAmount <= 0n) return { borrowApr, lendApr: new D(0) };
  const used = min(totalBorrowAmount, totalAssetAmount);
  const kept = sub0(FEE_PRECISION, feeToProtocolRate);
  const lendApr = new D((yearly * used * kept).toString()).div(
    (FRAXLEND_RATE_PRECISION * totalAssetAmount * FEE_PRECISION).toString(),
  );
  return { borrowApr, lendApr };
}
