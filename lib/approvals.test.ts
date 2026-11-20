import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import {
  AAVE_ENTIRE_BALANCE,
  MAX_APPROVAL,
  RAY,
  SECONDS_PER_YEAR,
  UnboundedApprovalError,
  aaveCompoundedInterest,
  aaveDebtAfter,
  assertBoundedApproval,
  ceilWithRepayBuffer,
  coversAccrual,
  exactApproval,
  isolatedTotalBorrowAfter,
  needsApproval,
  planCoreRepay,
  planIsolatedRepay,
  repayApproval,
  residualAllowance,
  sharesToAmountUp,
} from "./approvals";

const DECIMALS = [6, 18] as const;

describe("exact approvals (supply, deposit, add-collateral)", () => {
  it.each(DECIMALS)("approves exactly the amount moved (%i decimals)", (decimals) => {
    for (const human of ["0.000001", "1", "1.5", "123456.789"]) {
      const amount = parseUnits(human, decimals);
      if (amount === 0n) continue;
      expect(exactApproval(amount)).toBe(amount);
    }
    expect(exactApproval(1n)).toBe(1n);
  });

  it("never requests an unlimited or empty allowance", () => {
    expect(() => exactApproval(0n)).toThrow(UnboundedApprovalError);
    expect(() => exactApproval(MAX_APPROVAL + 1n)).toThrow(UnboundedApprovalError);
    expect(() => assertBoundedApproval((1n << 256n) - 1n)).toThrow(UnboundedApprovalError);
    expect(() => assertBoundedApproval(AAVE_ENTIRE_BALANCE)).toThrow(UnboundedApprovalError);
    expect(assertBoundedApproval(MAX_APPROVAL)).toBe(MAX_APPROVAL);
  });

  it("asks for an approval only when the allowance is short", () => {
    expect(needsApproval(undefined, 5n)).toBe(true);
    expect(needsApproval(4n, 5n)).toBe(true);
    expect(needsApproval(5n, 5n)).toBe(false);
    expect(needsApproval(0n, 0n)).toBe(false);
  });
});

describe("repay approval = ceil(assetValue × 1.001) + 1", () => {
  it("matches the formula on hand-checked values", () => {
    expect(repayApproval(1n)).toBe(3n); // ceil(1.001) = 2, + 1
    expect(repayApproval(999n)).toBe(1_001n); // ceil(999.999) = 1000, + 1
    expect(repayApproval(1_000n)).toBe(1_002n); // exactly 1001, + 1
    expect(repayApproval(1_000_000n)).toBe(1_001_001n); // 1 USDC
    expect(repayApproval(10n ** 18n)).toBe(1_001_000_000_000_000_001n); // 1 WETH
    expect(() => repayApproval(0n)).toThrow();
  });

  it.each(DECIMALS)("is the smallest integer >= x × 1.001, plus one (%i decimals)", (decimals) => {
    const samples = ["0.000001", "0.123456", "1", "7.777777", "1000000", "0.999999"].map((h) => parseUnits(h, decimals));
    for (const x of samples.filter((v) => v > 0n)) {
      const ceil = ceilWithRepayBuffer(x);
      expect(ceil * 1000n).toBeGreaterThanOrEqual(x * 1001n);
      expect((ceil - 1n) * 1000n).toBeLessThan(x * 1001n);
      expect(repayApproval(x)).toBe(ceil + 1n);
      expect(repayApproval(x)).toBeLessThanOrEqual(MAX_APPROVAL);
    }
  });

  it("reports the residual allowance left after the pull", () => {
    expect(residualAllowance(1_001_001n, 1_000_000n)).toBe(1_001n);
    expect(residualAllowance(5n, 9n)).toBe(0n);
  });
});

describe("core repay plan (partial and full)", () => {
  it.each(DECIMALS)("partial repay sends the amount and approves it with the buffer (%i decimals)", (decimals) => {
    const debt = parseUnits("100", decimals);
    const input = parseUnits("40", decimals);
    const plan = planCoreRepay({ input, debt });
    expect(plan.full).toBe(false);
    expect(plan.amountArg).toBe(input);
    expect(plan.approve).toBe(repayApproval(input));
  });

  it.each(DECIMALS)("full repay sends the entire-debt sentinel and approves the buffered debt (%i decimals)", (decimals) => {
    const debt = parseUnits("100.123", decimals);
    for (const input of [debt, debt + 5n]) {
      const plan = planCoreRepay({ input, debt });
      expect(plan.full).toBe(true);
      expect(plan.amountArg).toBe(AAVE_ENTIRE_BALANCE);
      expect(plan.approve).toBe(repayApproval(debt));
      // The sentinel is an amount argument only; it is never an allowance.
      expect(plan.approve).toBeLessThan(MAX_APPROVAL);
    }
  });
});

describe("isolated repay plan (share-based, partial and full)", () => {
  it.each(DECIMALS)("approves the buffered value of exactly the shares being repaid (%i decimals)", (decimals) => {
    const borrowedShares = parseUnits("90", decimals);
    const partial = planIsolatedRepay({
      full: false,
      borrowedShares,
      sharesForInput: parseUnits("30", decimals),
      shareValue: parseUnits("33.3", decimals),
    });
    expect(partial.shares).toBe(parseUnits("30", decimals));
    expect(partial.approve).toBe(repayApproval(parseUnits("33.3", decimals)));

    const full = planIsolatedRepay({
      full: true,
      borrowedShares,
      sharesForInput: 0n,
      shareValue: parseUnits("100", decimals),
    });
    expect(full.shares).toBe(borrowedShares);
    expect(full.approve).toBe(repayApproval(parseUnits("100", decimals)));
  });
});

// -------------------------------------------------------------------------------------------
// Spec §6.1, FE criterion: approve in block N, repay (partial and full) in block N + k after a
// time warp, at the maximum borrow rate. 1 block = 1 s on Lighter EVM devnet.
// -------------------------------------------------------------------------------------------

/** DefaultReserveInterestRateStrategyV2.MAX_BORROW_RATE = 1000_00 bps = 1000% APR (in ray). */
const CORE_MAX_RATE_RAY = 10n * RAY;
/**
 * VariableInterestRate MAX_FULL_UTIL_RATE of the isolated deployment (lumina-isolated
 * scripts/deploy-lighter.js: maxFullUtilizationRate = 31_890_000_000 per second, 1e18 precision,
 * ≈ 100% APR). The pair rate never exceeds it.
 */
const ISOLATED_MAX_RATE_PER_SEC = 31_890_000_000n;

/** Blocks within which the 10 bps buffer must hold at the max rate (1000% APR → ~52 min). */
const CORE_WARPS = [1n, 12n, 60n, 600n, 1_800n, 3_000n];
const ISOLATED_WARPS = [1n, 60n, 600n, 3_600n, 30_000n];

describe("spec §6.1 FE criterion: core (Aave variable debt)", () => {
  const index = RAY + RAY / 37n; // an already-accrued borrow index

  it("compound interest model matches the simple rate to first order", () => {
    const oneYear = aaveCompoundedInterest(RAY / 20n, SECONDS_PER_YEAR); // 5% APR
    expect(oneYear).toBeGreaterThan(RAY + RAY / 20n);
    expect(oneYear).toBeLessThan(RAY + RAY / 19n);
  });

  it.each(DECIMALS)("full repay: the debt at N+k fits the approval made at N (%i decimals)", (decimals) => {
    for (const human of ["0.000001", "1", "2500.5", "1000000"]) {
      const scaled = parseUnits(human, decimals);
      const debtAtN = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, 0n);
      const plan = planCoreRepay({ input: debtAtN, debt: debtAtN });
      for (const k of CORE_WARPS) {
        const debtAtRepay = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, k);
        expect(debtAtRepay).toBeGreaterThanOrEqual(debtAtN);
        expect(coversAccrual(plan.approve, debtAtRepay), `${human} after ${k}s`).toBe(true);
      }
    }
  });

  it.each(DECIMALS)("partial repay: the pool pulls exactly the amount, still covered at N+k (%i decimals)", (decimals) => {
    const scaled = parseUnits("1000", decimals);
    const debtAtN = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, 0n);
    const input = debtAtN / 3n;
    const plan = planCoreRepay({ input, debt: debtAtN });
    for (const k of CORE_WARPS) {
      const debtAtRepay = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, k);
      const pulled = input < debtAtRepay ? input : debtAtRepay; // Aave: min(amount, debt)
      expect(coversAccrual(plan.approve, pulled)).toBe(true);
    }
  });

  it("the buffer has a limit: far beyond it the old approval no longer covers a full repay", () => {
    const scaled = parseUnits("1000", 18);
    const debtAtN = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, 0n);
    const plan = planCoreRepay({ input: debtAtN, debt: debtAtN });
    const debtLater = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, 4_000n);
    expect(coversAccrual(plan.approve, debtLater)).toBe(false);
  });
});

describe("spec §6.1 FE criterion: isolated (FraxLend shares)", () => {
  // Pair accounting at block N: amount > shares after earlier accrual.
  const pairAt = (decimals: number) => ({
    totalAmount: parseUnits("1000000", decimals) + 12_345n,
    totalShares: parseUnits("950000", decimals),
  });

  it.each(DECIMALS)("full repay of all borrow shares at N+k fits the approval made at N (%i decimals)", (decimals) => {
    const { totalAmount, totalShares } = pairAt(decimals);
    for (const humanShares of ["0.000001", "1", "5000", "950000"]) {
      const shares = parseUnits(humanShares, decimals);
      const valueAtN = sharesToAmountUp(shares, totalAmount, totalShares);
      const plan = planIsolatedRepay({ full: true, borrowedShares: shares, sharesForInput: 0n, shareValue: valueAtN });
      for (const k of ISOLATED_WARPS) {
        const totalLater = isolatedTotalBorrowAfter(totalAmount, ISOLATED_MAX_RATE_PER_SEC, k);
        const pulled = sharesToAmountUp(plan.shares, totalLater, totalShares); // repayAsset → toAmount(roundUp)
        expect(coversAccrual(plan.approve, pulled), `${humanShares} shares after ${k}s`).toBe(true);
      }
    }
  });

  it.each(DECIMALS)("partial repay (shares for an amount) at N+k fits the approval made at N (%i decimals)", (decimals) => {
    const { totalAmount, totalShares } = pairAt(decimals);
    for (const humanInput of ["0.5", "17.25", "250000"]) {
      const input = parseUnits(humanInput, decimals);
      const sharesForInput = (input * totalShares) / totalAmount; // toBorrowShares(amount, roundUp = false)
      const valueAtN = sharesToAmountUp(sharesForInput, totalAmount, totalShares);
      expect(valueAtN).toBeLessThanOrEqual(input);
      const plan = planIsolatedRepay({ full: false, borrowedShares: totalShares, sharesForInput, shareValue: valueAtN });
      for (const k of ISOLATED_WARPS) {
        const totalLater = isolatedTotalBorrowAfter(totalAmount, ISOLATED_MAX_RATE_PER_SEC, k);
        const pulled = sharesToAmountUp(plan.shares, totalLater, totalShares);
        expect(pulled).toBeGreaterThanOrEqual(valueAtN);
        expect(coversAccrual(plan.approve, pulled), `${humanInput} after ${k}s`).toBe(true);
      }
    }
  });

  it("an exact (unbuffered) approval would fail after one block — the R1-5 / R2-1 bug", () => {
    const { totalAmount, totalShares } = pairAt(18);
    const shares = parseUnits("5000", 18);
    const valueAtN = sharesToAmountUp(shares, totalAmount, totalShares);
    const totalLater = isolatedTotalBorrowAfter(totalAmount, ISOLATED_MAX_RATE_PER_SEC, 1n);
    expect(coversAccrual(valueAtN, sharesToAmountUp(shares, totalLater, totalShares))).toBe(false);
    expect(coversAccrual(repayApproval(valueAtN), sharesToAmountUp(shares, totalLater, totalShares))).toBe(true);
  });

  it("the buffer has a limit: far beyond it the old approval no longer covers", () => {
    const { totalAmount, totalShares } = pairAt(6);
    const shares = parseUnits("5000", 6);
    const valueAtN = sharesToAmountUp(shares, totalAmount, totalShares);
    const totalLater = isolatedTotalBorrowAfter(totalAmount, ISOLATED_MAX_RATE_PER_SEC, 40_000n);
    expect(coversAccrual(repayApproval(valueAtN), sharesToAmountUp(shares, totalLater, totalShares))).toBe(false);
  });
});
