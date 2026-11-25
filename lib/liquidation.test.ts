import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  CLOSE_FACTOR_HF_THRESHOLD,
  DEFAULT_LIQUIDATION_CLOSE_FACTOR,
  GUARD_CALL_GAS,
  ISOLATED_LIQ_DEADLINE_SEC,
  ISOLATED_LIQ_GAS_BUFFER,
  ISOLATED_LIQ_GAS_PADDING,
  ISOLATED_LIQ_MARGIN_BPS,
  LIQ_PRECISION,
  MAX_LIQUIDATION_CLOSE_FACTOR,
  bufferedBorrowTotals,
  closeFactorFor,
  dirtyPartialWithinCleanBuffer,
  fitsLiquidationMargin,
  isRemainderCovered,
  isolatedLiquidationMax,
  maxLiquidatableDebt,
  percentDiv,
  percentMul,
  repaymentExceedsCollateral,
  simulateIsolatedLiquidation,
  type IsolatedLiquidationParams,
} from "./liquidation";
import { EXCHANGE_PRECISION } from "./borrowMax";
import {
  SECONDS_PER_YEAR,
  ceilWithRepayBuffer,
  isolatedTotalBorrowAfter,
  vaultToAmount,
} from "./approvals";

const hf = (n: string) => parseUnits(n, 18);
const usd8 = (n: number) => BigInt(Math.round(n * 1e8));

// USDC debt (6), WETH collateral (18), ETH $2000, bonus 5% (10500)
const base = {
  userDebt: parseUnits("100", 6),
  collateralBalance: parseUnits("1", 18), // $2000 of collateral: plenty
  debtPrice: usd8(1),
  collateralPrice: usd8(2000),
  debtDecimals: 6,
  collateralDecimals: 18,
  liquidationBonus: 10_500n,
};

describe("Aave v3.2 close factor (LiquidationLogic)", () => {
  it("uses the contract constants", () => {
    expect(DEFAULT_LIQUIDATION_CLOSE_FACTOR).toBe(5_000n);
    expect(MAX_LIQUIDATION_CLOSE_FACTOR).toBe(10_000n);
    expect(CLOSE_FACTOR_HF_THRESHOLD).toBe(950_000_000_000_000_000n);
    expect(closeFactorFor(CLOSE_FACTOR_HF_THRESHOLD)).toBe(10_000n); // `>` threshold → default
    expect(closeFactorFor(CLOSE_FACTOR_HF_THRESHOLD + 1n)).toBe(5_000n);
  });

  it("HF 0.96: 50% of the debt", () => {
    const limit = maxLiquidatableDebt({ ...base, healthFactor: hf("0.96") })!;
    expect(limit.closeFactor).toBe(5_000n);
    expect(limit.maxDebtToCover).toBe(parseUnits("50", 6));
    expect(limit.collateralLimited).toBe(false);
  });

  it("HF 0.90: 100% of the debt (Codex #11)", () => {
    const limit = maxLiquidatableDebt({ ...base, healthFactor: hf("0.90") })!;
    expect(limit.closeFactor).toBe(10_000n);
    expect(limit.maxDebtToCover).toBe(parseUnits("100", 6));
  });

  it("HF 0.90 with little collateral: capped by the collateral at the bonus", () => {
    // 0.03 WETH = $60 of collateral → debt needed = 60 / 1.05 = 57.142857 USDC
    const limit = maxLiquidatableDebt({ ...base, healthFactor: hf("0.90"), collateralBalance: parseUnits("0.03", 18) })!;
    expect(limit.collateralLimited).toBe(true);
    expect(limit.maxDebtToCover).toBe(percentDiv(parseUnits("60", 6), 10_500n));
    expect(limit.maxDebtToCover).toBe(57_142_857n);
  });

  it("nothing is liquidatable at HF >= 1", () => {
    expect(maxLiquidatableDebt({ ...base, healthFactor: hf("1") })).toBeNull();
  });

  it("PercentageMath rounds half up", () => {
    expect(percentMul(3n, 5_000n)).toBe(2n); // 1.5 → 2
    expect(percentDiv(1n, 30_000n)).toBe(0n);
  });
});

// =============================================================================================
// Isolated pair (LightlendPairCore.liquidate) exact integer arithmetic & F5/F8 amount policy
// =============================================================================================

const E6 = 10n ** 6n;
const E18 = 10n ** 18n;
/** Pair rate for USDC (6 dec) debt, WETH (18 dec) collateral: WETH wei per USDC base unit × 1e18. */
const usdcWethRate = (ethUsd: bigint) => (10n ** 30n) / ethUsd;

/** Default LightlendPair fees: 5% clean, 4.5% dirty (90% of clean), 10% protocol share of bonus. */
const DEFAULT_FEES = {
  cleanLiquidationFee: 5_000n,
  dirtyLiquidationFee: 4_500n,
  protocolLiquidationFee: 10_000n,
};

describe("isolated liquidation constants (F2, F8)", () => {
  it("matches LightlendPairConstants, F2 gas rule and F8 parameters", () => {
    expect(LIQ_PRECISION).toBe(100_000n);
    expect(GUARD_CALL_GAS).toBe(1_000_000n);
    expect(ISOLATED_LIQ_GAS_BUFFER).toBe(100_000n);
    expect(ISOLATED_LIQ_GAS_PADDING).toBe(1_100_000n);
    expect(ISOLATED_LIQ_DEADLINE_SEC).toBe(120);
    expect(ISOLATED_LIQ_MARGIN_BPS).toBe(100n);
  });
});

describe("simulateIsolatedLiquidation: exact LightlendPairCore integer arithmetic", () => {
  it("branch calculation rounds down (toAmount false) while repayment rounds up (toAmount true)", () => {
    // Non-1:1 share price where floor and ceil diverge by 1 base unit.
    // totalAmount + 1000 = 1_000_001_000, totalShares + 1000 = 1_000_000_000 → 1 share = 1.000001.
    const totalBorrow = { amount: 1_000_000_000n, shares: 999_999_000n };
    // Actually let's pick a ratio where shares=3 gives floor=3, ceil=4:
    // totalAmount+1000 = 1500, totalShares+1000 = 1200 → 1.25 per share: 3 shares = 3.75 → floor 3, ceil 4.
    const tb = { amount: 500n, shares: 200n };
    expect(vaultToAmount(tb, 3n, false)).toBe(3n);
    expect(vaultToAmount(tb, 3n, true)).toBe(4n);

    const params: IsolatedLiquidationParams = {
      borrowerShares: 10n,
      collateral: 100n * E18,
      totalBorrow: tb,
      exchangeRate: E18, // 1:1 collateral:asset
      ...DEFAULT_FEES,
    };
    const sim = simulateIsolatedLiquidation(params, 3n);
    expect(sim.amountDown).toBe(3n);
    expect(sim.repayment).toBe(4n);
    expect(sim.liquidationAmountInCollateralUnits).toBe(3n);
    expect(sim.isClean).toBe(false);
    // Notice: if the ratio uses totalBorrow above instead:
    expect(vaultToAmount(totalBorrow, 1n, false)).toBe(1n);
    expect(vaultToAmount(totalBorrow, 1n, true)).toBe(2n);
  });

  it("clean/dirty boundary share and its predecessor (spec §5 F8)", () => {
    // 1000 USDC debt (1:1 shares), 1 WETH collateral at ETH = $1,000 → rate = 1e27.
    // Clean threshold: optimistic = floor((amountDown * 1e27 / 1e18) * 105_000 / 100_000) >= 1e18.
    // amountDown = 952_380_952 → liqAmt = 952_380_952e9 → optimistic = 999_999_999_600_000_000 < 1e18 (DIRTY).
    // amountDown = 952_380_953 → liqAmt = 952_380_953e9 → optimistic = 1_000_000_000_650_000_000 >= 1e18 (CLEAN).
    const params: IsolatedLiquidationParams = {
      borrowerShares: 1_000n * E6,
      collateral: E18,
      totalBorrow: { amount: 1_000n * E6, shares: 1_000n * E6 },
      exchangeRate: usdcWethRate(1_000n),
      ...DEFAULT_FEES,
    };

    const predecessor = simulateIsolatedLiquidation(params, 952_380_952n);
    expect(predecessor.isClean).toBe(false);
    expect(predecessor.collateralSeized).toBe(995_238_094_840_000_000n);
    expect(predecessor.protocolFee).toBe(4_285_714_284_000_000n);
    expect(predecessor.collateralReceived).toBe(990_952_380_556_000_000n);
    expect(predecessor.collateralSeized).toBe(predecessor.collateralReceived + predecessor.protocolFee);
    expect(predecessor.repayment).toBe(952_380_952n);
    expect(predecessor.sharesToAdjust).toBe(0n);
    expect(predecessor.writeOff).toBe(0n);

    const boundary = simulateIsolatedLiquidation(params, 952_380_953n);
    expect(boundary.isClean).toBe(true);
    expect(boundary.collateralSeized).toBe(E18);
    // bonus = 1e18 - 952_380_953e9 = 47_619_047e9; protocolFee = 10% = 4_761_904_700_000_000
    expect(boundary.protocolFee).toBe(4_761_904_700_000_000n);
    expect(boundary.collateralReceived).toBe(E18 - 4_761_904_700_000_000n);
    expect(boundary.repayment).toBe(952_380_953n);
    expect(boundary.sharesToAdjust).toBe(1_000n * E6 - 952_380_953n);
    expect(boundary.writeOff).toBe(47_619_047n);
  });

  it("underwater full liquidation takes 0 protocol fee (ISO-01: bonus only) and writes off nothing", () => {
    // Audit N-FE-01 example: 3,000 USDC debt, 1 WETH collateral at ETH = $2,800.
    const rate = usdcWethRate(2_800n);
    const params: IsolatedLiquidationParams = {
      borrowerShares: 3_000n * E6,
      collateral: E18,
      totalBorrow: { amount: 3_000n * E6, shares: 3_000n * E6 },
      exchangeRate: rate,
      ...DEFAULT_FEES,
    };
    const full = simulateIsolatedLiquidation(params, 3_000n * E6);
    expect(full.isClean).toBe(true);
    expect(full.collateralSeized).toBe(E18);
    expect(full.protocolFee).toBe(0n);
    expect(full.collateralReceived).toBe(E18);
    expect(full.repayment).toBe(3_000n * E6);
    expect(full.writeOff).toBe(0n);
    expect(repaymentExceedsCollateral(full, rate)).toBe(true);
  });
});

describe("isolatedLiquidationMax: F5/F8 amount policy (0 floor, 1% margin)", () => {
  it("equity inside the 1% margin (80% LTV, dirty path) → full repayment, no write-off", () => {
    // 1,600 USDC debt against 1 WETH at $2,000 (80% LTV, insolvent above 75% maxLTV).
    const params: IsolatedLiquidationParams = {
      borrowerShares: 1_600n * E6,
      collateral: E18,
      totalBorrow: { amount: 1_600n * E6, shares: 1_600n * E6 },
      exchangeRate: usdcWethRate(2_000n),
      ...DEFAULT_FEES,
    };
    const res = isolatedLiquidationMax(params);
    expect(res.hasEquity).toBe(true);
    expect(res.mode).toBe("full");
    expect(res.shares).toBe(1_600n * E6);
    expect(res.outcome!.isClean).toBe(false);
    expect(res.outcome!.writeOff).toBe(0n);
    expect(fitsLiquidationMargin(res.outcome!, params.exchangeRate)).toBe(true);
  });

  it("equity inside the 1% margin (96% LTV, clean path) → full repayment, no write-off", () => {
    // 1,920 USDC debt against 1 WETH at $2,000 (96% LTV).
    // Full repay: collateralSeized = 1 WETH ($2,000), bonus = $80, fee = $8, received = $1,992.
    // 99% of $1,992 = $1,972.08 >= $1,920 → fits inside 1% margin!
    const params: IsolatedLiquidationParams = {
      borrowerShares: 1_920n * E6,
      collateral: E18,
      totalBorrow: { amount: 1_920n * E6, shares: 1_920n * E6 },
      exchangeRate: usdcWethRate(2_000n),
      ...DEFAULT_FEES,
    };
    const res = isolatedLiquidationMax(params);
    expect(res.hasEquity).toBe(true);
    expect(res.mode).toBe("full");
    expect(res.shares).toBe(1_920n * E6);
    expect(res.outcome!.isClean).toBe(true);
    expect(res.outcome!.writeOff).toBe(0n);
    expect(fitsLiquidationMargin(res.outcome!, params.exchangeRate)).toBe(true);
  });

  it("equity outside the 1% margin (2,790 USDC debt vs $2,800 collateral) → ~222 USDC dirty partial keeping remainder covered, no write-off (rev 3.1)", () => {
    // Spec rev 3.1 example: 2,790 USDC debt against 1 WETH collateral worth $2,800 ($10 equity).
    // Full repayment receives ~$2,799 (>= $2,790, has equity) but 99% of $2,799 = $2,771.01 < $2,790
    // (outside 1% margin). Largest dirty partial keeping remaining debt covered ≈ equity / dirtyFee ≈ 222.22 USDC.
    const params: IsolatedLiquidationParams = {
      borrowerShares: 2_790n * E6,
      collateral: E18,
      totalBorrow: { amount: 2_790n * E6, shares: 2_790n * E6 },
      exchangeRate: usdcWethRate(2_800n),
      ...DEFAULT_FEES,
    };
    const full = simulateIsolatedLiquidation(params, params.borrowerShares);
    expect(repaymentExceedsCollateral(full, params.exchangeRate)).toBe(false); // has equity
    expect(fitsLiquidationMargin(full, params.exchangeRate)).toBe(false); // outside 1% margin

    const res = isolatedLiquidationMax(params);
    expect(res.hasEquity).toBe(true);
    expect(res.mode).toBe("dirty");
    expect(res.shares).toBe(222_222_222n); // ~$222.222222 USDC
    expect(res.outcome!.isClean).toBe(false);
    expect(res.outcome!.writeOff).toBe(0n);
    expect(fitsLiquidationMargin(res.outcome!, params.exchangeRate)).toBe(true);
    expect(isRemainderCovered(params, res.outcome!)).toBe(true);

    // Boundary check: shares is covered; successor shares + 1 is NOT covered (and still dirty).
    const next = simulateIsolatedLiquidation(params, res.shares + 1n);
    expect(next.isClean).toBe(false);
    expect(next.writeOff).toBe(0n);
    expect(isRemainderCovered(params, next)).toBe(false);
  });

  it("equity outside the 1% margin (995 USDC vs $1,000 collateral) → boundary share covered, successor not covered, never a clean partial (spec §5, criterion 9)", () => {
    // 995 USDC debt against 1 WETH at $1,000 (99.5% LTV, $5 equity).
    // Full repay: received = 0.9995 WETH ($999.50) >= $995 (has equity),
    // but 99% of $999.50 = $989.505 < $995 (outside 1% margin).
    // Largest dirty partial keeping remainder covered: $5 / 0.045 = 111.111111 USDC.
    const params: IsolatedLiquidationParams = {
      borrowerShares: 995n * E6,
      collateral: E18,
      totalBorrow: { amount: 995n * E6, shares: 995n * E6 },
      exchangeRate: usdcWethRate(1_000n),
      ...DEFAULT_FEES,
    };
    const full = simulateIsolatedLiquidation(params, params.borrowerShares);
    expect(repaymentExceedsCollateral(full, params.exchangeRate)).toBe(false);
    expect(fitsLiquidationMargin(full, params.exchangeRate)).toBe(false);

    const res = isolatedLiquidationMax(params);
    expect(res.hasEquity).toBe(true);
    expect(res.mode).toBe("dirty");
    expect(res.shares).toBe(111_111_111n);
    expect(res.outcome!.isClean).toBe(false);
    expect(res.outcome!.writeOff).toBe(0n);
    expect(fitsLiquidationMargin(res.outcome!, params.exchangeRate)).toBe(true);
    expect(isRemainderCovered(params, res.outcome!)).toBe(true);

    const next = simulateIsolatedLiquidation(params, res.shares + 1n);
    expect(next.isClean).toBe(false);
    expect(isRemainderCovered(params, next)).toBe(false);
  });

  it("thin equity where even the smallest dirty amount leaves remainder uncovered or fails margin → MAX is 0 (mode none)", () => {
    // Exact 100% LTV (zero equity): even 1 share takes dirty bonus out of lenders' coverage.
    const zeroEquity: IsolatedLiquidationParams = {
      borrowerShares: 1_000n * E6,
      collateral: E18,
      totalBorrow: { amount: 1_000n * E6, shares: 1_000n * E6 },
      exchangeRate: usdcWethRate(1_000n),
      ...DEFAULT_FEES,
    };
    expect(isolatedLiquidationMax(zeroEquity)).toEqual({ shares: 0n, hasEquity: true, mode: "none", outcome: null });

    // Strictly positive but sub-fee equity on USDC/WETH: equity = 10_000_000 WETH wei,
    // while dirty bonus on even s = 1 share is 45_000_000 WETH wei > equity.
    const subFeeUsdcWeth: IsolatedLiquidationParams = {
      borrowerShares: 1_000n * E6,
      collateral: E18 + 10_000_000n,
      totalBorrow: { amount: 1_000n * E6, shares: 1_000n * E6 },
      exchangeRate: usdcWethRate(1_000n),
      ...DEFAULT_FEES,
    };
    const subFeeRes = isolatedLiquidationMax(subFeeUsdcWeth);
    expect(subFeeRes).toEqual({ shares: 0n, hasEquity: true, mode: "none", outcome: null });
    expect(isRemainderCovered(subFeeUsdcWeth, simulateIsolatedLiquidation(subFeeUsdcWeth, 1n))).toBe(false);

    // Thin positive equity on WETH/USDC (exchangeRate = 2.8e9): equity is 50_000_000 WETH wei (0.14 USDC wei).
    // Small dirty amounts (k <= 22) have 0 bonus (fail 1% margin), and even the smallest positive-bonus
    // plateau (k = 23, seized = 24, 99% = 23.76 → at most 0.76 USDC wei rounding slack) cannot fit
    // 1 USDC wei of bonus inside 0.14 + 0.76 = 0.90 USDC wei without leaving the remainder uncovered.
    const thinWethUsdc: IsolatedLiquidationParams = {
      borrowerShares: E18 - 50_000_000n,
      collateral: 2_800n * E6,
      totalBorrow: { amount: E18, shares: E18 },
      exchangeRate: 2_800n * E6,
      ...DEFAULT_FEES,
    };
    expect(isolatedLiquidationMax(thinWethUsdc)).toEqual({ shares: 0n, hasEquity: true, mode: "none", outcome: null });
  });

  it("under-water position → largest clean amount staying inside the 1% margin (minimizes write-off)", () => {
    // Audit N-FE-01: 3,000 USDC debt, 1 WETH at $2,800.
    const params: IsolatedLiquidationParams = {
      borrowerShares: 3_000n * E6,
      collateral: E18,
      totalBorrow: { amount: 3_000n * E6, shares: 3_000n * E6 },
      exchangeRate: usdcWethRate(2_800n),
      ...DEFAULT_FEES,
    };
    const res = isolatedLiquidationMax(params);
    expect(res.hasEquity).toBe(false);
    expect(res.mode).toBe("clean");
    expect(res.outcome!.isClean).toBe(true);
    expect(res.shares).toBeGreaterThan(2_666_666_667n); // larger than cleanMin (~2666.67 USDC)
    expect(res.shares).toBeLessThan(2_772_000_000n); // smaller than 99% of $2800 because of 10% protocol fee on bonus
    expect(fitsLiquidationMargin(res.outcome!, params.exchangeRate)).toBe(true);
    expect(repaymentExceedsCollateral(res.outcome!, params.exchangeRate)).toBe(false);
    expect(res.outcome!.writeOff).toBeGreaterThan(0n);
    expect(res.outcome!.writeOff).toBeLessThan(250n * E6); // only ~231 USDC written off, not 333 USDC

    // Exact maximality: shares + 1 MUST violate the 1% margin!
    const oneMore = simulateIsolatedLiquidation(params, res.shares + 1n);
    expect(oneMore.isClean).toBe(true);
    expect(fitsLiquidationMargin(oneMore, params.exchangeRate)).toBe(false);
  });

  it("degenerate positions (zero shares, zero collateral, zero rate) → shares 0, mode none", () => {
    const baseIso: IsolatedLiquidationParams = {
      borrowerShares: 1_000n * E6,
      collateral: E18,
      totalBorrow: { amount: 1_000n * E6, shares: 1_000n * E6 },
      exchangeRate: usdcWethRate(2_000n),
      ...DEFAULT_FEES,
    };
    expect(isolatedLiquidationMax({ ...baseIso, borrowerShares: 0n })).toMatchObject({ shares: 0n, mode: "none", outcome: null });
    expect(isolatedLiquidationMax({ ...baseIso, collateral: 0n })).toMatchObject({ shares: 0n, mode: "none", outcome: null });
    expect(isolatedLiquidationMax({ ...baseIso, exchangeRate: 0n })).toMatchObject({ shares: 0n, mode: "none", outcome: null });
  });

  it("equity outside margin when dirty fee cannot cover the 1% margin → skips (shares 0, mode none)", () => {
    // Artificial low-fee pair where dirty net bonus < 1% margin: must skip, never pick a clean partial.
    const params: IsolatedLiquidationParams = {
      borrowerShares: 995n * E6,
      collateral: E18,
      totalBorrow: { amount: 995n * E6, shares: 995n * E6 },
      exchangeRate: usdcWethRate(1_000n),
      cleanLiquidationFee: 1_000n, // 1%
      dirtyLiquidationFee: 900n, // 0.9% (< 1% margin)
      protocolLiquidationFee: 10_000n,
    };
    const res = isolatedLiquidationMax(params);
    expect(res.hasEquity).toBe(true);
    expect(res.mode).toBe("none");
    expect(res.shares).toBe(0n);
  });

  it("spec rev 3.3: dirty partial keeps repay-buffer headroom below clean threshold across 1 block of interest", () => {
    // 10% borrow APR in FraxLend 1e18 rate-per-second precision (~317 micro-USDC per 1s block on 100k USDC).
    const ratePerSec10Pct = 10n ** 17n / SECONDS_PER_YEAR;
    const rate = usdcWethRate(2_000n); // ETH = $2,000

    // 1) Exact review example: 100,000 USDC debt vs 52.25 WETH ($104,500) collateral, default fees.
    // Clean threshold is 99,523.809524 USDC; 99,523.809523 is dirty at block B but flips clean after 1 block
    // (~317–318 micro-USDC of interest) and writes off ~476.19 USDC.
    const reviewParams: IsolatedLiquidationParams = {
      borrowerShares: 100_000n * E6,
      collateral: 52_250_000_000_000_000_000n, // 52.25 WETH = $104,500
      totalBorrow: { amount: 100_000n * E6, shares: 100_000n * E6 },
      exchangeRate: rate,
      ...DEFAULT_FEES,
    };
    const nextBlockTotals = {
      amount: isolatedTotalBorrowAfter(reviewParams.totalBorrow.amount, ratePerSec10Pct, 1n),
      shares: reviewParams.totalBorrow.shares,
    };
    expect(nextBlockTotals.amount - reviewParams.totalBorrow.amount).toBeGreaterThanOrEqual(317n);

    const realCleanMin = 99_523_809_524n;
    const unbufferedDirty = realCleanMin - 1n;
    expect(simulateIsolatedLiquidation(reviewParams, unbufferedDirty).isClean).toBe(false);
    expect(simulateIsolatedLiquidation(reviewParams, realCleanMin).isClean).toBe(true);

    // One block of interest turns unbufferedDirty into a clean liquidation writing off ~476.19 USDC:
    const afterOneBlockUnbuffered = simulateIsolatedLiquidation({ ...reviewParams, totalBorrow: nextBlockTotals }, unbufferedDirty);
    expect(afterOneBlockUnbuffered.isClean).toBe(true);
    expect(afterOneBlockUnbuffered.writeOff).toBeGreaterThan(476n * E6);

    // Buffered totalBorrow uses the existing repay approval buffer (ceilWithRepayBuffer = 1001/1000).
    const buffered = bufferedBorrowTotals(reviewParams.totalBorrow);
    expect(buffered).toEqual({
      amount: ceilWithRepayBuffer(reviewParams.totalBorrow.amount),
      shares: reviewParams.totalBorrow.shares,
    });
    const bufferedParams = { ...reviewParams, totalBorrow: buffered };
    // Buffered clean boundary: smallest share that is clean at +10 bps borrow total.
    const bufferedCleanMin = 99_424_385_140n;
    expect(simulateIsolatedLiquidation(bufferedParams, bufferedCleanMin).isClean).toBe(true);
    expect(simulateIsolatedLiquidation(bufferedParams, bufferedCleanMin - 1n).isClean).toBe(false);

    // Typed amounts inside [bufferedCleanMin, realCleanMin - 1] on a position with equity are blocked:
    expect(dirtyPartialWithinCleanBuffer(reviewParams, unbufferedDirty)).toBe(true);
    expect(dirtyPartialWithinCleanBuffer(reviewParams, 99_500n * E6)).toBe(true);
    expect(dirtyPartialWithinCleanBuffer(reviewParams, bufferedCleanMin)).toBe(true);
    // Below bufferedCleanMin, already clean, full repayment, far from boundary, or underwater are NOT blocked:
    expect(dirtyPartialWithinCleanBuffer(reviewParams, bufferedCleanMin - 1n)).toBe(false);
    expect(dirtyPartialWithinCleanBuffer(reviewParams, 50_000n * E6)).toBe(false);
    expect(dirtyPartialWithinCleanBuffer(reviewParams, realCleanMin)).toBe(false);
    expect(dirtyPartialWithinCleanBuffer(reviewParams, reviewParams.borrowerShares)).toBe(false);
    const underwaterParams: IsolatedLiquidationParams = {
      ...reviewParams,
      collateral: 45n * E18, // $90,000 < $100,000
    };
    expect(dirtyPartialWithinCleanBuffer(underwaterParams, 85_650n * E6)).toBe(false);

    // 2) MAX in the equity dirty branch when large equity leaves remainder-covered non-binding:
    //    (a) $100,000 debt vs $104,490 collateral (52.245 WETH), DEFAULT_FEES (5% / 4.5% / 10%), marginBps = 389n.
    const nearFullEquity: IsolatedLiquidationParams = {
      borrowerShares: 100_000n * E6,
      collateral: 52_245_000_000_000_000_000n, // $104,490 ($4,490 equity; remainder-covered cap ≈ 99,777.78 > cleanMin ≈ 99,514.29)
      totalBorrow: { amount: 100_000n * E6, shares: 100_000n * E6 },
      exchangeRate: rate,
      ...DEFAULT_FEES,
    };
    const resNearFull = isolatedLiquidationMax(nearFullEquity, 389n);
    expect(resNearFull.hasEquity).toBe(true);
    expect(resNearFull.mode).toBe("dirty");
    // Exact simulation returned to user stays on the real totals:
    expect(resNearFull.outcome).toEqual(simulateIsolatedLiquidation(nearFullEquity, resNearFull.shares));
    expect(resNearFull.outcome!.isClean).toBe(false);
    expect(resNearFull.outcome!.writeOff).toBe(0n);
    // Stays below the buffered clean boundary (and successor enters the buffered clean zone):
    const bufferedNearFull = { ...nearFullEquity, totalBorrow: bufferedBorrowTotals(nearFullEquity.totalBorrow) };
    expect(simulateIsolatedLiquidation(bufferedNearFull, resNearFull.shares).isClean).toBe(false);
    expect(simulateIsolatedLiquidation(bufferedNearFull, resNearFull.shares + 1n).isClean).toBe(true);
    expect(dirtyPartialWithinCleanBuffer(nearFullEquity, resNearFull.shares)).toBe(false);
    // Simulating the chosen shares after 1 block of 10% APR interest is still dirty (0 write-off):
    const afterOneBlockChosen = simulateIsolatedLiquidation(
      { ...nearFullEquity, totalBorrow: nextBlockTotals },
      resNearFull.shares,
    );
    expect(afterOneBlockChosen.isClean).toBe(false);
    expect(afterOneBlockChosen.writeOff).toBe(0n);

    //    (b) Default 1% margin (marginBps = 100n): $100,000 debt vs $101,120 collateral (50.56 WETH),
    //        cleanFee = 5%, dirtyFee = 1.15%, protocolFee = 10% (remainder-covered ≈ 97,391 > cleanMin ≈ 96,304.76).
    const defaultMarginDirtyBoundary: IsolatedLiquidationParams = {
      borrowerShares: 100_000n * E6,
      collateral: 50_560_000_000_000_000_000n, // $101,120
      totalBorrow: { amount: 100_000n * E6, shares: 100_000n * E6 },
      exchangeRate: rate,
      cleanLiquidationFee: 5_000n,
      dirtyLiquidationFee: 1_150n,
      protocolLiquidationFee: 10_000n,
    };
    const resDefault = isolatedLiquidationMax(defaultMarginDirtyBoundary);
    expect(resDefault.hasEquity).toBe(true);
    expect(resDefault.mode).toBe("dirty");
    expect(resDefault.outcome).toEqual(simulateIsolatedLiquidation(defaultMarginDirtyBoundary, resDefault.shares));
    expect(resDefault.outcome!.writeOff).toBe(0n);
    const bufferedDefault = {
      ...defaultMarginDirtyBoundary,
      totalBorrow: bufferedBorrowTotals(defaultMarginDirtyBoundary.totalBorrow),
    };
    expect(simulateIsolatedLiquidation(bufferedDefault, resDefault.shares).isClean).toBe(false);
    expect(simulateIsolatedLiquidation(bufferedDefault, resDefault.shares + 1n).isClean).toBe(true);
    expect(
      simulateIsolatedLiquidation({ ...defaultMarginDirtyBoundary, totalBorrow: nextBlockTotals }, resDefault.shares).isClean,
    ).toBe(false);
  });

  it("positions far from the clean boundary are unchanged by the accrual buffer", () => {
    // 2,790 USDC vs $2,800 collateral: remainder-covered binds at ~222.22 USDC, far below bufferedCleanMin (~2,664 USDC).
    const params: IsolatedLiquidationParams = {
      borrowerShares: 2_790n * E6,
      collateral: E18,
      totalBorrow: { amount: 2_790n * E6, shares: 2_790n * E6 },
      exchangeRate: usdcWethRate(2_800n),
      ...DEFAULT_FEES,
    };
    const res = isolatedLiquidationMax(params);
    expect(res.mode).toBe("dirty");
    expect(res.shares).toBe(222_222_222n);
    expect(dirtyPartialWithinCleanBuffer(params, res.shares)).toBe(false);
  });

  it("matches exhaustive brute-force search across share ratios (<1, =1, >1), directions (USDC/WETH & WETH/USDC) and fee regimes", () => {
    function bruteForceMax(
      params: IsolatedLiquidationParams,
      marginBps: bigint = ISOLATED_LIQ_MARGIN_BPS,
    ): { shares: bigint; mode: "full" | "dirty" | "clean" | "none" } {
      const full = simulateIsolatedLiquidation(params, params.borrowerShares);
      const hasEquity = !repaymentExceedsCollateral(full, params.exchangeRate);
      if (hasEquity) {
        if (fitsLiquidationMargin(full, params.exchangeRate, marginBps)) {
          return { shares: params.borrowerShares, mode: "full" };
        }
        const bufferedParams: IsolatedLiquidationParams = {
          ...params,
          totalBorrow: bufferedBorrowTotals(params.totalBorrow),
        };
        for (let s = params.borrowerShares; s >= 1n; s -= 1n) {
          const sim = simulateIsolatedLiquidation(params, s);
          const bufferedSim = simulateIsolatedLiquidation(bufferedParams, s);
          if (
            !sim.isClean &&
            !bufferedSim.isClean &&
            isRemainderCovered(params, sim) &&
            fitsLiquidationMargin(sim, params.exchangeRate, marginBps)
          ) {
            return { shares: s, mode: "dirty" };
          }
        }
        return { shares: 0n, mode: "none" };
      }
      for (let s = params.borrowerShares; s >= 1n; s -= 1n) {
        const sim = simulateIsolatedLiquidation(params, s);
        if (sim.isClean && fitsLiquidationMargin(sim, params.exchangeRate, marginBps)) return { shares: s, mode: "clean" };
      }
      return { shares: 0n, mode: "none" };
    }

    const cases: Array<{ params: IsolatedLiquidationParams; marginBps?: bigint }> = [
      // Share price > 1, underwater, 10% protocol fee
      {
        params: {
          borrowerShares: 1_500n,
          collateral: 1_200n,
          totalBorrow: { amount: 2_345n, shares: 1_500n },
          exchangeRate: EXCHANGE_PRECISION,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 10_000n,
        },
      },
      // Share price < 1 (post-write-off), underwater, 50% protocol fee (max)
      {
        params: {
          borrowerShares: 2_000n,
          collateral: 900n,
          totalBorrow: { amount: 500n, shares: 2_000n },
          exchangeRate: EXCHANGE_PRECISION,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 50_000n,
        },
      },
      // Equity outside 1% margin with non-1:1 share price (A > S)
      {
        params: {
          borrowerShares: 1_200n,
          collateral: 1_372n,
          totalBorrow: { amount: 1_500n, shares: 1_200n },
          exchangeRate: EXCHANGE_PRECISION,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 10_000n,
        },
      },
      // Equity outside 1% margin with share price < 1 (post-write-off) and parity oscillation
      {
        params: {
          borrowerShares: 1_001n,
          collateral: 504n,
          totalBorrow: { amount: 500n, shares: 2_000n },
          exchangeRate: EXCHANGE_PRECISION,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 10_000n,
        },
      },
      // Equity outside 1% margin with R < E (WETH/USDC direction, flickering plateaus)
      {
        params: {
          borrowerShares: 10_005n,
          collateral: 1_008n,
          totalBorrow: { amount: 10_005n, shares: 10_005n },
          exchangeRate: EXCHANGE_PRECISION / 10n,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 10_000n,
        },
      },
      // Equity outside 1% margin with R > E (USDC/WETH direction) and A > S
      {
        params: {
          borrowerShares: 1_001n,
          collateral: 150_800n,
          totalBorrow: { amount: 500n, shares: 0n }, // (500+1000)/(0+1000) = 1.5 per share → 1501.5 debt
          exchangeRate: EXCHANGE_PRECISION * 100n,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 10_000n,
        },
      },
      // Equity outside 1% margin where buffered clean boundary binds BEFORE remainder-covered (R = E, A = S)
      {
        params: {
          borrowerShares: 10_000n,
          collateral: 10_112n,
          totalBorrow: { amount: 10_000n, shares: 10_000n },
          exchangeRate: EXCHANGE_PRECISION,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 1_150n,
          protocolLiquidationFee: 10_000n,
        },
      },
      // Equity outside 1% margin where buffered clean boundary binds BEFORE remainder-covered (R > E, A > S)
      {
        params: {
          borrowerShares: 2_000n,
          collateral: 313_470n, // debt 3,100 * 100 = 310,000; equity 3,470 (1.12%)
          totalBorrow: { amount: 3_650n, shares: 2_000n }, // (3650+1000)/(2000+1000) = 1.55 per share
          exchangeRate: EXCHANGE_PRECISION * 100n,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 1_150n,
          protocolLiquidationFee: 10_000n,
        },
      },
      // Equity outside 1% margin where buffered clean boundary binds BEFORE remainder-covered (R < E, A < S)
      {
        params: {
          borrowerShares: 10_000n,
          collateral: 809n, // debt 8,000 * 0.1 = 800; equity 9 (1.125%)
          totalBorrow: { amount: 7_800n, shares: 10_000n }, // (7800+1000)/(10000+1000) = 0.8 per share
          exchangeRate: EXCHANGE_PRECISION / 10n,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 1_250n,
          protocolLiquidationFee: 15_000n,
        },
      },
      // Equity outside margin where buffered clean boundary binds with DEFAULT_FEES (5% / 4.5% / 10%)
      {
        params: {
          borrowerShares: 10_000n,
          collateral: 10_449n,
          totalBorrow: { amount: 10_000n, shares: 10_000n },
          exchangeRate: EXCHANGE_PRECISION,
          ...DEFAULT_FEES,
        },
        marginBps: 389n,
      },
      // Thin equity outside 1% margin → mode "none"
      {
        params: {
          borrowerShares: 1_000n,
          collateral: 1_000n,
          totalBorrow: { amount: 1_000n, shares: 1_000n },
          exchangeRate: EXCHANGE_PRECISION,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 10_000n,
        },
      },
      // Small exchangeRate (WETH/USDC-like direction where 1 collateral wei spans multiple asset wei), underwater
      {
        params: {
          borrowerShares: 2_000n,
          collateral: 150n,
          totalBorrow: { amount: 2_000n, shares: 2_000n },
          exchangeRate: EXCHANGE_PRECISION / 10n, // 0.1 collateral per asset
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 50_000n,
        },
      },
      // Zero protocol fee, underwater
      {
        params: {
          borrowerShares: 1_000n,
          collateral: 800n,
          totalBorrow: { amount: 1_000n, shares: 1_000n },
          exchangeRate: EXCHANGE_PRECISION,
          cleanLiquidationFee: 5_000n,
          dirtyLiquidationFee: 4_500n,
          protocolLiquidationFee: 0n,
        },
      },
    ];

    for (const c of cases) {
      const margin = c.marginBps ?? ISOLATED_LIQ_MARGIN_BPS;
      const expected = bruteForceMax(c.params, margin);
      const actual = isolatedLiquidationMax(c.params, margin);
      expect({ shares: actual.shares, mode: actual.mode }).toEqual(expected);
    }
  });
});
