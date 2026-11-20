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
  coreFullRepayFunding,
  hasExecutionHeadroom,
  repayHeadroom,
  vaultToAmount,
  vaultToShares,
  walletBoundedShares,
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
  it.each(DECIMALS)("partial repay sends the finite amount; the allowance threshold is the buffered amount (%i decimals)", (decimals) => {
    const debt = parseUnits("100", decimals);
    const input = parseUnits("40", decimals);
    const plan = planCoreRepay({ input, debt, repayAll: false });
    expect(plan.full).toBe(false);
    expect(plan.amountArg).toBe(input);
    // Codex #4a: the threshold for a partial repay is buffered too, not the raw amount.
    expect(plan.approve).toBe(repayApproval(input));
    expect(needsApproval(input, plan.approve)).toBe(true);
  });

  it.each(DECIMALS)("'repay all' intent sends the entire-debt sentinel and approves the buffered current debt (%i decimals)", (decimals) => {
    const debt = parseUnits("100.123", decimals);
    const plan = planCoreRepay({ input: 0n, debt, repayAll: true });
    expect(plan.full).toBe(true);
    expect(plan.amountArg).toBe(AAVE_ENTIRE_BALANCE);
    expect(plan.approve).toBe(repayApproval(debt));
    // The sentinel is an amount argument only; it is never an allowance.
    expect(plan.approve).toBeLessThan(MAX_APPROVAL);
  });

  it("a typed amount equal to the debt stays finite without the intent", () => {
    const debt = parseUnits("100", 6);
    expect(planCoreRepay({ input: debt, debt, repayAll: false }).amountArg).toBe(debt);
  });

  it("debt refreshing from 100 to 100.000001 after MAX: still the sentinel, approval covers the new debt (Codex #5)", () => {
    const before = planCoreRepay({ input: parseUnits("100", 6), debt: parseUnits("100", 6), repayAll: true });
    const after = planCoreRepay({ input: parseUnits("100", 6), debt: parseUnits("100.000001", 6), repayAll: true });
    expect(before.amountArg).toBe(AAVE_ENTIRE_BALANCE);
    expect(after.amountArg).toBe(AAVE_ENTIRE_BALANCE);
    expect(after.approve).toBe(repayApproval(parseUnits("100.000001", 6)));
    expect(coversAccrual(after.approve, parseUnits("100.000001", 6))).toBe(true);
  });

  it("a full repay needs the wallet to hold the execution headroom over the debt, else offers the wallet (Codex #6)", () => {
    const debt = parseUnits("1", 18);
    expect(coreFullRepayFunding(debt, debt)).toEqual({ fundable: false, partial: debt });
    expect(coreFullRepayFunding(repayHeadroom(debt), debt)).toEqual({ fundable: true });
    expect(coreFullRepayFunding(repayHeadroom(debt) - 1n, debt).fundable).toBe(false);
    expect(coreFullRepayFunding(parseUnits("0.4", 18), debt)).toEqual({ fundable: false, partial: parseUnits("0.4", 18) });
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

describe("execution headroom after the approval (Gemini r2 C1)", () => {
  it("is ceil(value × 1.0005) + 1, half of the approval buffer", () => {
    expect(repayHeadroom(1n)).toBe(3n); // ceil(1.0005) = 2, + 1
    expect(repayHeadroom(10_000n)).toBe(10_006n);
    expect(repayHeadroom(10_001n)).toBe(10_008n); // ceil(10006.0005) = 10007, + 1
    expect(repayHeadroom(parseUnits("1", 18))).toBe(parseUnits("1.0005", 18) + 1n);
    expect(repayHeadroom(0n)).toBe(1n);
  });

  it.each(DECIMALS)("is never above the approval for the same value (%i decimals)", (decimals) => {
    for (const human of ["0.000001", "1", "123.456", "1000000"]) {
      const v = parseUnits(human, decimals);
      expect(repayHeadroom(v)).toBeLessThanOrEqual(repayApproval(v));
    }
  });

  it("Gemini's case: 1 WETH at 5% APR, approval mined 2 s later — the old approval still has headroom", () => {
    const debtN = parseUnits("1", 18);
    const approved = repayApproval(debtN); // 1.001000000000000001 WETH
    const debtNow = 1_000_000_003_170_979_198n; // two seconds of 5% APR interest
    // The round-1 rule (a fresh full buffer) wrongly asks for a new approval:
    expect(approved < repayApproval(debtNow)).toBe(true);
    // The headroom rule lets the repay go out:
    expect(hasExecutionHeadroom({ allowance: approved, wallet: parseUnits("2", 18), value: debtNow })).toBe(true);
    // …but still refuses when allowance or wallet cannot cover the headroom.
    expect(hasExecutionHeadroom({ allowance: debtNow, wallet: parseUnits("2", 18), value: debtNow })).toBe(false);
    expect(hasExecutionHeadroom({ allowance: approved, wallet: debtNow, value: debtNow })).toBe(false);
  });
});

describe("wallet-bounded share repay (Gemini r2 M1)", () => {
  const totals = { amount: parseUnits("1000000", 6) + 12_345n, shares: parseUnits("950000", 6) };

  it("the offered shares' value plus headroom fits the wallet, and one more share would not", () => {
    for (const human of ["1", "37.5", "999.999999"]) {
      const wallet = parseUnits(human, 6);
      const shares = walletBoundedShares(wallet, totals, parseUnits("950000", 6));
      expect(shares).toBeGreaterThan(0n);
      expect(repayHeadroom(vaultToAmount(totals, shares, true))).toBeLessThanOrEqual(wallet);
      expect(repayHeadroom(vaultToAmount(totals, shares + 1n, true))).toBeGreaterThan(wallet);
    }
  });

  it("is capped at the borrow shares and is 0 for an empty wallet", () => {
    expect(walletBoundedShares(parseUnits("1000000", 6), totals, 5n)).toBe(5n);
    expect(walletBoundedShares(0n, totals, 100n)).toBe(0n);
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
      const plan = planCoreRepay({ input: debtAtN, debt: debtAtN, repayAll: true });
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
    const plan = planCoreRepay({ input, debt: debtAtN, repayAll: false });
    for (const k of CORE_WARPS) {
      const debtAtRepay = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, k);
      const pulled = input < debtAtRepay ? input : debtAtRepay; // Aave: min(amount, debt)
      expect(coversAccrual(plan.approve, pulled)).toBe(true);
    }
  });

  it("the buffer has a limit: far beyond it the old approval no longer covers a full repay", () => {
    const scaled = parseUnits("1000", 18);
    const debtAtN = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, 0n);
    const plan = planCoreRepay({ input: debtAtN, debt: debtAtN, repayAll: true });
    const debtLater = aaveDebtAfter(scaled, index, CORE_MAX_RATE_RAY, 4_000n);
    expect(coversAccrual(plan.approve, debtLater)).toBe(false);
  });
});

describe("VaultAccount rounding (lumina-isolated contracts/libraries/VaultAccount.sol)", () => {
  it("applies the 1e3 virtual amount and shares like the contract (Codex #14 case)", () => {
    // total debt 1000, total shares 1: one share is (1 × 2000) / 1001 = 1, rounded up to 2.
    expect(vaultToAmount({ amount: 1_000n, shares: 1n }, 1n, true)).toBe(2n);
    expect(vaultToAmount({ amount: 1_000n, shares: 1n }, 1n, false)).toBe(1n);
    // Without the offsets one share would be worth 1000; the contract never does that.
    expect(vaultToAmount({ amount: 1_000n, shares: 1n }, 1n, true)).not.toBe(1_000n);
    // toShares mirrors it: 2 raw units buy (2 × 1001) / 2000 = 1 share.
    expect(vaultToShares({ amount: 1_000n, shares: 1n }, 2n, false)).toBe(1n);
    // Empty vault: 1:1 through the offsets.
    expect(vaultToAmount({ amount: 0n, shares: 0n }, 5n, true)).toBe(5n);
  });
});

describe("spec §6.1 FE criterion: isolated (FraxLend shares, VaultAccount rounding)", () => {
  // Pair accounting at block N: amount > shares after earlier accrual.
  const pairAt = (decimals: number) => ({
    amount: parseUnits("1000000", decimals) + 12_345n,
    shares: parseUnits("950000", decimals),
  });

  /** Pair state at N+k: accrued totalBorrow amount, same shares (worst-case remainder carry). */
  const later = (total: { amount: bigint; shares: bigint }, k: bigint) => ({
    amount: isolatedTotalBorrowAfter(total.amount, ISOLATED_MAX_RATE_PER_SEC, k),
    shares: total.shares,
  });

  it.each(DECIMALS)("full repay of all borrow shares at N+k fits the approval made at N (%i decimals)", (decimals) => {
    const total = pairAt(decimals);
    for (const humanShares of ["0.000001", "1", "5000", "950000"]) {
      const shares = parseUnits(humanShares, decimals);
      const valueAtN = vaultToAmount(total, shares, true); // toBorrowAmount(shares, true, true)
      const plan = planIsolatedRepay({ full: true, borrowedShares: shares, sharesForInput: 0n, shareValue: valueAtN });
      for (const k of ISOLATED_WARPS) {
        const pulled = vaultToAmount(later(total, k), plan.shares, true); // repayAsset → toAmount(roundUp)
        expect(coversAccrual(plan.approve, pulled), `${humanShares} shares after ${k}s`).toBe(true);
      }
    }
  });

  it.each(DECIMALS)("partial repay (shares for an amount) at N+k fits the approval made at N (%i decimals)", (decimals) => {
    const total = pairAt(decimals);
    for (const humanInput of ["0.5", "17.25", "250000"]) {
      const input = parseUnits(humanInput, decimals);
      const sharesForInput = vaultToShares(total, input, false); // toBorrowShares(amount, false, true)
      const valueAtN = vaultToAmount(total, sharesForInput, true);
      expect(valueAtN).toBeLessThanOrEqual(input + 1n);
      const plan = planIsolatedRepay({ full: false, borrowedShares: total.shares, sharesForInput, shareValue: valueAtN });
      for (const k of ISOLATED_WARPS) {
        const pulled = vaultToAmount(later(total, k), plan.shares, true);
        expect(pulled).toBeGreaterThanOrEqual(valueAtN);
        expect(coversAccrual(plan.approve, pulled), `${humanInput} after ${k}s`).toBe(true);
      }
    }
  });

  it("the Codex case: tiny vault (debt 1000, shares 1), one share at N and after accrual", () => {
    const total = { amount: 1_000n, shares: 1n };
    const valueAtN = vaultToAmount(total, 1n, true);
    expect(valueAtN).toBe(2n);
    const plan = planIsolatedRepay({ full: true, borrowedShares: 1n, sharesForInput: 0n, shareValue: valueAtN });
    expect(plan.approve).toBe(4n); // ceil(2 × 1.001) + 1
    for (const k of ISOLATED_WARPS) {
      expect(coversAccrual(plan.approve, vaultToAmount(later(total, k), 1n, true))).toBe(true);
    }
  });

  it("an exact (unbuffered) approval fails after accrual — the R1-5 / R2-1 bug", () => {
    const total = pairAt(18);
    const shares = parseUnits("5000", 18);
    const valueAtN = vaultToAmount(total, shares, true);
    const pulled = vaultToAmount(later(total, 1n), shares, true);
    expect(coversAccrual(valueAtN, pulled)).toBe(false);
    expect(coversAccrual(repayApproval(valueAtN), pulled)).toBe(true);
  });

  it("the buffer has a limit: far beyond it the old approval no longer covers", () => {
    const total = pairAt(6);
    const shares = parseUnits("5000", 6);
    const valueAtN = vaultToAmount(total, shares, true);
    const pulled = vaultToAmount(later(total, 40_000n), shares, true);
    expect(coversAccrual(repayApproval(valueAtN), pulled)).toBe(false);
  });
});
