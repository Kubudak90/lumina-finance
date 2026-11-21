import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import parity from "../test/fixtures/core-parity.json";
import { vaultToAmount } from "./approvals";
import {
  MAX_HEALTH_FACTOR,
  WAD,
  accountData,
  applyCoreAction,
  applyIsolatedAction,
  aprToApy,
  borrowLimitUsed,
  buildCoreSnapshot,
  coreApy,
  corePreview,
  coreRisk,
  formatHealth,
  isolatedAprs,
  isolatedLiquidationPrice,
  isolatedLtvOf,
  isolatedPreview,
  isolatedRisk,
  rayToApr,
  type CoreAccountData,
  type CoreReserve,
  type CoreSnapshot,
  type IsolatedMarketSides,
  type IsolatedState,
} from "./risk";

const E6 = 10n ** 6n;
const E8 = 10n ** 8n;
const E18 = 10n ** 18n;
const WETH = "0x660000000000000000000000000000000000000c";
const USDC = "0xf2A5728d366c6d0f764Af612cD47F3608E2B4d5B";
const DAI = "0x00000000000000000000000000000000000000da";

/** Narrow a result to its available branch (fails the test otherwise). */
function ok<T extends { available: boolean }>(r: T): Extract<T, { available: true }> {
  if (!r.available) throw new Error(`unavailable: ${JSON.stringify(r)}`);
  return r as Extract<T, { available: true }>;
}

function weth(p: Partial<CoreReserve> = {}): CoreReserve {
  return {
    asset: WETH,
    symbol: "WETH",
    decimals: 18,
    ltv: 7500n,
    liquidationThreshold: 8000n,
    price: 2_000n * E8,
    supplied: 0n,
    borrowed: 0n,
    collateralEnabled: false,
    ...p,
  };
}

function usdc(p: Partial<CoreReserve> = {}): CoreReserve {
  return {
    asset: USDC,
    symbol: "USDC",
    decimals: 6,
    ltv: 7500n,
    liquidationThreshold: 7800n,
    price: E8,
    supplied: 0n,
    borrowed: 0n,
    collateralEnabled: false,
    ...p,
  };
}

const snap = (...reserves: CoreReserve[]): CoreSnapshot => ({ eMode: 0n, reserves });

// =============================================================================================
// Core
// =============================================================================================

describe("core accountData: exact parity with getUserAccountData (harness fixtures, same block)", () => {
  const toSnapshot = (c: (typeof parity.cases)[number]): CoreSnapshot => ({
    eMode: BigInt(c.eMode),
    reserves: c.reserves.map((r) => ({
      asset: r.asset,
      symbol: r.symbol,
      decimals: r.decimals,
      ltv: BigInt(r.ltv),
      liquidationThreshold: BigInt(r.liquidationThreshold),
      price: BigInt(r.price),
      supplied: BigInt(r.supplied),
      borrowed: BigInt(r.borrowed),
      collateralEnabled: r.collateralEnabled,
    })),
  });

  it("covers single collateral, two collaterals, collateral disabled and debt", () => {
    const names = parity.cases.map((c) => c.name);
    expect(names).toEqual([
      "single collateral, no debt",
      "single collateral, USDC debt",
      "two collaterals, USDC and WETH debt",
      "USDC collateral disabled, with debt",
    ]);
    const s = parity.cases.map(toSnapshot);
    expect(s[0].reserves.filter((r) => r.collateralEnabled && r.supplied! > 0n)).toHaveLength(1);
    expect(s[2].reserves.filter((r) => r.collateralEnabled && r.supplied! > 0n)).toHaveLength(2);
    const disabled = s[3].reserves.find((r) => r.symbol === "USDC")!;
    expect(disabled.supplied! > 0n && disabled.collateralEnabled === false).toBe(true);
    expect(s.slice(1).every((x) => x.reserves.some((r) => r.borrowed! > 0n))).toBe(true);
  });

  for (const c of parity.cases) {
    it(`${c.name} (block ${c.block})`, () => {
      const d = ok(accountData(toSnapshot(c)));
      expect(d.totalCollateralBase).toBe(BigInt(c.accountData.totalCollateralBase));
      expect(d.totalDebtBase).toBe(BigInt(c.accountData.totalDebtBase));
      expect(d.availableBorrowsBase).toBe(BigInt(c.accountData.availableBorrowsBase));
      expect(d.avgLiquidationThreshold).toBe(BigInt(c.accountData.currentLiquidationThreshold));
      expect(d.avgLtv).toBe(BigInt(c.accountData.ltv));
      expect(d.healthFactor).toBe(BigInt(c.accountData.healthFactor));
    });
  }

  it("the two-collateral case exercises the integer-bps floor of avgLT", () => {
    const d = ok(accountData(toSnapshot(parity.cases[2])));
    // 7957 bps: between USDC's 7800 and WETH's 8000, floored.
    expect(d.avgLiquidationThreshold).toBe(7957n);
  });

  it("buildCoreSnapshot maps hook-shaped reads (number bps configs) to the same result", () => {
    const c = parity.cases[2];
    const fixture = toSnapshot(c);
    const built = buildCoreSnapshot({
      eMode: 0n,
      positions: fixture.reserves.map((r) => ({ ...r })),
      configOf: (asset) => {
        const r = fixture.reserves.find((x) => x.asset === asset)!;
        return { ltv: Number(r.ltv), liquidationThreshold: Number(r.liquidationThreshold) };
      },
      priceOf: (asset) => fixture.reserves.find((x) => x.asset === asset)!.price,
    });
    expect(ok(accountData(built)).healthFactor).toBe(BigInt(c.accountData.healthFactor));
  });
});

describe("core accountData: hand-checked values", () => {
  it("10 WETH ($20,000, LT 80%) against 8,000 USDC: HF 2.0, limit used 53.33%", () => {
    const d = ok(accountData(snap(weth({ supplied: 10n * E18, collateralEnabled: true }), usdc({ borrowed: 8_000n * E6 }))));
    expect(d.totalCollateralBase).toBe(20_000n * E8);
    expect(d.totalDebtBase).toBe(8_000n * E8);
    expect(d.healthFactor).toBe(2n * WAD);
    expect(d.availableBorrowsBase).toBe(7_000n * E8);
    // 8,000 / (20,000 × 75%) = 0.5333…
    expect(borrowLimitUsed(d)).toEqual({ kind: "ratio", wad: (8_000n * WAD) / 15_000n });
  });

  it("no debt: HF ∞, borrow limit 0%, liquidation price none", () => {
    const r = ok(coreRisk(snap(weth({ supplied: E18, collateralEnabled: true }))));
    expect(r.healthFactor).toBe(MAX_HEALTH_FACTOR);
    expect(r.borrowLimitUsed).toEqual({ kind: "ratio", wad: 0n });
    expect(r.liquidationPrice).toEqual({ kind: "none" });
  });

  it("no positions at all: empty account (GenericLogic's isEmpty branch)", () => {
    const d = ok(accountData(snap(weth(), usdc())));
    expect(d).toMatchObject({ totalCollateralBase: 0n, totalDebtBase: 0n, avgLtv: 0n, avgLiquidationThreshold: 0n, healthFactor: MAX_HEALTH_FACTOR });
  });

  it("debt with zero capacity: borrow limit 'over 100%' and HF 0", () => {
    const r = ok(coreRisk(snap(weth({ supplied: E18, collateralEnabled: false }), usdc({ borrowed: 100n * E6 }))));
    expect(r.borrowLimitUsed).toEqual({ kind: "over" });
    expect(r.healthFactor).toBe(0n);
  });

  it("a supplied balance with collateral off counts for nothing and needs no price", () => {
    const d = ok(accountData(snap(weth({ supplied: E18, collateralEnabled: false, price: undefined }))));
    expect(d.totalCollateralBase).toBe(0n);
  });

  it("a failed balance, flag or price read is unavailable, never zero", () => {
    expect(accountData(snap(weth({ supplied: undefined })))).toEqual({ available: false, reason: "missing-input" });
    expect(accountData(snap(weth({ supplied: E18, collateralEnabled: undefined })))).toEqual({ available: false, reason: "missing-input" });
    expect(accountData(snap(weth({ supplied: E18, collateralEnabled: true, price: undefined })))).toEqual({ available: false, reason: "missing-input" });
    expect(accountData({ eMode: undefined, reserves: [weth()] })).toEqual({ available: false, reason: "missing-input" });
  });
});

describe("core after-state (per reserve, from one snapshot)", () => {
  const base = snap(weth({ supplied: 10n * E18, collateralEnabled: true }), usdc({ borrowed: 8_000n * E6 }));

  it("supply: the first supply auto-enables collateral when the reserve LTV > 0", () => {
    const p = corePreview(base, { kind: "supply", asset: USDC, amount: 2_000n * E6 });
    const after = ok(p.after);
    expect(after.totalCollateralBase).toBe(22_000n * E8);
    // (20,000 × 0.8 + 2,000 × 0.78) / 8,000, with Aave's integer avgLT: floor(17,560 / 22,000 bps).
    expect(after.avgLiquidationThreshold).toBe(7981n);
    expect(applyCoreAction(base, { kind: "supply", asset: USDC, amount: 2_000n * E6 }).snapshot!.reserves[1].collateralEnabled).toBe(true);
  });

  it("supply: no auto-enable with LTV 0, and none when the user turned collateral off on a held balance", () => {
    const ltv0 = snap(weth({ supplied: 10n * E18, collateralEnabled: true }), usdc({ ltv: 0n, borrowed: 8_000n * E6 }));
    expect(ok(corePreview(ltv0, { kind: "supply", asset: USDC, amount: 2_000n * E6 }).after).totalCollateralBase).toBe(20_000n * E8);
    const off = snap(weth({ supplied: 10n * E18, collateralEnabled: true }), usdc({ supplied: 500n * E6, collateralEnabled: false, borrowed: 8_000n * E6 }));
    const p = corePreview(off, { kind: "supply", asset: USDC, amount: 2_000n * E6 });
    expect(ok(p.after).totalCollateralBase).toBe(20_000n * E8);
    expect(ok(p.after).healthFactor).toBe(ok(p.before).healthFactor);
  });

  it("supply of collateral that is already on raises collateral", () => {
    const p = corePreview(base, { kind: "supply", asset: WETH, amount: 5n * E18 });
    expect(ok(p.after).totalCollateralBase).toBe(30_000n * E8);
    expect(ok(p.after).healthFactor).toBe(3n * WAD);
  });

  it("withdraw: partial, all, and over-balance (clamped, flagged invalid)", () => {
    const partial = corePreview(base, { kind: "withdraw", asset: WETH, amount: 5n * E18 });
    expect(ok(partial.after).healthFactor).toBe(WAD); // 10,000 × 0.8 / 8,000
    expect(partial.invalid).toBe(false);
    const all = corePreview(base, { kind: "withdraw", asset: WETH, amount: "all" });
    expect(ok(all.after).totalCollateralBase).toBe(0n);
    expect(ok(all.after).healthFactor).toBe(0n);
    expect(all.invalid).toBe(false);
    const over = corePreview(base, { kind: "withdraw", asset: WETH, amount: 50n * E18 });
    expect(over.invalid).toBe(true);
    expect(over.clamped).toBe(true);
    expect(ok(over.after)).toEqual(ok(all.after));
    // Withdrawing everything clears the collateral flag (SupplyLogic.executeWithdraw).
    expect(applyCoreAction(base, { kind: "withdraw", asset: WETH, amount: "all" }).snapshot!.reserves[0].collateralEnabled).toBe(false);
  });

  it("an over-balance withdraw never eats another asset's collateral (r1 #6)", () => {
    const two = snap(weth({ supplied: E18, collateralEnabled: true }), usdc({ supplied: 5_000n * E6, collateralEnabled: true }));
    const p = corePreview(two, { kind: "withdraw", asset: WETH, amount: 2n * E18 });
    expect(ok(p.after).totalCollateralBase).toBe(5_000n * E8);
  });

  it("borrow grows the asset debt", () => {
    const p = corePreview(base, { kind: "borrow", asset: USDC, amount: 2_000n * E6 });
    expect(ok(p.after).totalDebtBase).toBe(10_000n * E8);
    expect(ok(p.after).healthFactor).toBe((16n * WAD) / 10n);
  });

  it("repay: over-debt is clamped to this asset's debt (no bleed into WETH debt); repay-all", () => {
    const mixed = snap(weth({ supplied: 2n * E18, collateralEnabled: true, borrowed: E18 }), usdc({ borrowed: 1_000n * E6 }));
    const before = ok(coreRisk(mixed));
    expect(before.totalDebtBase).toBe(3_000n * E8);
    const over = corePreview(mixed, { kind: "repay", asset: USDC, amount: 1_500n * E6 });
    expect(ok(over.after).totalDebtBase).toBe(2_000n * E8);
    expect(ok(over.after).healthFactor).toBe((16n * WAD) / 10n); // 4,000 × 0.8 / 2,000
    expect(over.clamped).toBe(true);
    expect(over.invalid).toBe(false);
    const all = corePreview(mixed, { kind: "repay", asset: USDC, amount: "all" });
    expect(ok(all.after)).toEqual(ok(over.after));
  });

  it("enable and disable flip the flag and preview the full balance", () => {
    const two = snap(
      weth({ supplied: 10n * E18, collateralEnabled: true }),
      usdc({ supplied: 10_000n * E6, collateralEnabled: true, borrowed: 8_000n * E6 }),
    );
    const disable = corePreview(two, { kind: "setCollateral", asset: USDC, enabled: false });
    expect(ok(disable.before).totalCollateralBase).toBe(30_000n * E8);
    expect(ok(disable.after).totalCollateralBase).toBe(20_000n * E8);
    expect(ok(disable.after).healthFactor).toBe(2n * WAD);
    const disabled = applyCoreAction(two, { kind: "setCollateral", asset: USDC, enabled: false }).snapshot!;
    const enable = corePreview(disabled, { kind: "setCollateral", asset: USDC, enabled: true });
    expect(ok(enable.after)).toEqual(ok(disable.before));
  });

  it("before and after come from the same snapshot (the input is not mutated)", () => {
    const copy = structuredClone(base);
    corePreview(base, { kind: "borrow", asset: USDC, amount: 1n });
    expect(base).toEqual(copy);
  });

  it("an action on an asset outside the snapshot is unavailable", () => {
    expect(corePreview(base, { kind: "supply", asset: DAI, amount: 1n }).after).toEqual({ available: false, reason: "unknown-reserve" });
  });
});

describe("core liquidation price: the full (A, B) partition", () => {
  const lp = (s: CoreSnapshot) => {
    const r = coreRisk(s);
    return r.available ? r.liquidationPrice : r;
  };

  it("debt = 0 → none", () => {
    expect(lp(snap(weth({ supplied: E18, collateralEnabled: true })))).toEqual({ kind: "none" });
  });

  it("A > 0, B > 0 → below p* (10 WETH at LT 80% against 8,000 USDC: $1,000)", () => {
    expect(lp(snap(weth({ supplied: 10n * E18, collateralEnabled: true }), usdc({ borrowed: 8_000n * E6 })))).toEqual({
      kind: "below",
      price: 1_000n * E8,
    });
  });

  it("A < 0, B < 0 → above p* (1 WETH debt against 5,000 USDC at LT 78%: $3,900)", () => {
    expect(lp(snap(weth({ borrowed: E18 }), usdc({ supplied: 5_000n * E6, collateralEnabled: true })))).toEqual({
      kind: "above",
      price: 3_900n * E8,
    });
  });

  it("A < 0, B ≥ 0 → now", () => {
    // B = 0: 1 WETH collateral (LT 80%) against 1 WETH debt.
    expect(lp(snap(weth({ supplied: E18, collateralEnabled: true, borrowed: E18 })))).toEqual({ kind: "now" });
    // B > 0: WETH debt and USDC debt, no USDC collateral.
    expect(lp(snap(weth({ supplied: E18, collateralEnabled: true, borrowed: E18 }), usdc({ borrowed: 10n * E6 })))).toEqual({ kind: "now" });
  });

  it("A = 0, B > 0 → now (1,000 USDC at LT 78% against 800 USDC)", () => {
    expect(lp(snap(weth(), usdc({ supplied: 1_000n * E6, collateralEnabled: true, borrowed: 800n * E6 })))).toEqual({ kind: "now" });
  });

  it("A > 0, B ≤ 0 → none", () => {
    expect(
      lp(snap(weth({ supplied: E18, collateralEnabled: true }), usdc({ supplied: 10_000n * E6, collateralEnabled: true, borrowed: 1_000n * E6 }))),
    ).toEqual({ kind: "none" });
  });

  it("A = 0, B ≤ 0 → none", () => {
    expect(lp(snap(weth(), usdc({ supplied: 10_000n * E6, collateralEnabled: true, borrowed: 1_000n * E6 })))).toEqual({ kind: "none" });
  });

  it("only collateral-enabled balances count", () => {
    // WETH balance present but disabled: A = −0 … the USDC debt has no cover at all.
    expect(lp(snap(weth({ supplied: 10n * E18, collateralEnabled: false }), usdc({ borrowed: 100n * E6 })))).toEqual({ kind: "now" });
  });

  it("a held reserve outside {USDC, WETH} → unavailable", () => {
    const dai: CoreReserve = { ...usdc({ supplied: 100n * E6, collateralEnabled: true }), asset: DAI, symbol: "DAI" };
    const s = snap(weth({ supplied: E18, collateralEnabled: true }), usdc({ borrowed: 100n * E6 }), dai);
    expect(ok(coreRisk(s)).liquidationPrice).toEqual({ kind: "unavailable", reason: "unknown-reserve" });
  });

  it("the price is where HF crosses 1: just below p* is liquidatable, just above is not", () => {
    const s = snap(weth({ supplied: 10n * E18, collateralEnabled: true }), usdc({ borrowed: 8_000n * E6 }));
    const at = (price: bigint) => ok(accountData(snap(weth({ supplied: 10n * E18, collateralEnabled: true, price }), usdc({ borrowed: 8_000n * E6 })))).healthFactor;
    expect(ok(coreRisk(s)).liquidationPrice).toEqual({ kind: "below", price: 1_000n * E8 });
    expect(at(1_000n * E8 - 1n) < WAD).toBe(true);
    expect(at(1_000n * E8 + E8)).toBeGreaterThanOrEqual(WAD);
  });
});

describe("eMode ≠ 0 or an unknown reserve: unavailable (spec §3.1, r2 #4)", () => {
  const s = snap(weth({ supplied: 10n * E18, collateralEnabled: true }), usdc({ borrowed: 8_000n * E6 }));

  it("eMode ≠ 0 → HF, borrow limit and liquidation price all unavailable, before and after", () => {
    const e: CoreSnapshot = { ...s, eMode: 1n };
    expect(accountData(e)).toEqual({ available: false, reason: "emode" });
    expect(coreRisk(e)).toEqual({ available: false, reason: "emode" });
    const p = corePreview(e, { kind: "borrow", asset: USDC, amount: E6 });
    expect(p.before).toEqual({ available: false, reason: "emode" });
    expect(p.after).toEqual({ available: false, reason: "emode" });
  });

  it("a held reserve whose config is not loaded → unavailable", () => {
    const unknown: CoreReserve = { ...usdc({ supplied: E6, collateralEnabled: true }), asset: DAI, symbol: "DAI", ltv: undefined, liquidationThreshold: undefined };
    expect(coreRisk({ ...s, reserves: [...s.reserves, unknown] })).toEqual({ available: false, reason: "unknown-reserve" });
  });
});

// =============================================================================================
// Isolated
// =============================================================================================

const USDC_WETH: IsolatedMarketSides = { assetSymbol: "USDC", collateralSymbol: "WETH", assetDecimals: 6, collateralDecimals: 18 };
const WETH_USDC: IsolatedMarketSides = { assetSymbol: "WETH", collateralSymbol: "USDC", assetDecimals: 18, collateralDecimals: 6 };
/** WETH per USDC × 1e18 at ETH $2,000. */
const R_USDC_WETH = 5n * 10n ** 26n;
const TB = { amount: 1_000n * E6, shares: 900n * E6 };

function iso(p: Partial<IsolatedState> = {}): IsolatedState {
  const borrowedShares = p.borrowedShares ?? 450n * E6;
  return {
    debt: vaultToAmount(TB, borrowedShares, true),
    borrowedShares,
    collateral: E18,
    maxLTV: 75_000n,
    exchangeRate: R_USDC_WETH,
    isBadData: false,
    totalBorrow: TB,
    ...p,
  };
}

describe("isolated LTV and after-state", () => {
  const ltv = (s: IsolatedState) => isolatedLtvOf(s);

  it("1,000 USDC against 1 WETH at $2,000: 50%", () => {
    expect(ltv(iso({ debt: 1_000n * E6 }))).toEqual({ kind: "value", ltv: 50_000n });
  });

  it("borrow (with collateral posted in the same call)", () => {
    const s = iso({ debt: 1_000n * E6 });
    const p = isolatedPreview(s, { kind: "borrow", amount: 200n * E6 }, USDC_WETH);
    expect(p.after.ltv).toEqual({ kind: "value", ltv: 60_000n });
    const withCollateral = isolatedPreview(s, { kind: "borrow", amount: 1_000n * E6, collateral: E18 }, USDC_WETH);
    expect(withCollateral.after.ltv).toEqual({ kind: "value", ltv: 50_000n });
    expect(withCollateral.afterState.collateral).toBe(2n * E18);
  });

  it("repay by amount, over-amount clamped to 0 and flagged", () => {
    const s = iso({ debt: 1_000n * E6 });
    const half = applyIsolatedAction(s, { kind: "repay", amount: 500n * E6 });
    expect(half.state.debt).toBe(500n * E6);
    expect(isolatedLtvOf(half.state)).toEqual({ kind: "value", ltv: 25_000n });
    const over = applyIsolatedAction(s, { kind: "repay", amount: 5_000n * E6 });
    expect(over.invalid).toBe(true);
    expect(over.state.debt).toBe(0n);
    expect(over.state.borrowedShares).toBe(0n);
  });

  it("repay by shares uses the remaining shares at the previewed post-repay totals", () => {
    const s = iso();
    const r = applyIsolatedAction(s, { kind: "repayShares", shares: 150n * E6 });
    expect(r.invalid).toBe(false);
    expect(r.state.borrowedShares).toBe(300n * E6);
    const pulled = vaultToAmount(TB, 150n * E6, true);
    const totalAfter = { amount: TB.amount - pulled, shares: TB.shares - 150n * E6 };
    expect(r.state.totalBorrow).toEqual(totalAfter);
    expect(r.state.debt).toBe(vaultToAmount(totalAfter, 300n * E6, true));
    // ≈ two thirds of 500 USDC (share price 1000/900).
    expect(r.state.debt! - 333_333_334n).toBeLessThanOrEqual(2n);
  });

  it("repay by shares above the borrowed shares is clamped to 0 and flagged invalid; 'all' repays everything", () => {
    const s = iso();
    const over = applyIsolatedAction(s, { kind: "repayShares", shares: 600n * E6 });
    expect(over.invalid).toBe(true);
    expect(over.state.borrowedShares).toBe(0n);
    expect(over.state.debt).toBe(0n);
    expect(isolatedLtvOf(over.state)).toEqual({ kind: "value", ltv: 0n });
    const all = applyIsolatedAction(s, { kind: "repayShares", shares: "all" });
    expect(all.invalid).toBe(false);
    expect(all.state.debt).toBe(0n);
  });

  it("the last borrow share writes off the residual total (as _repayAsset)", () => {
    const s = iso({ borrowedShares: TB.shares });
    expect(applyIsolatedAction(s, { kind: "repayShares", shares: "all" }).state.totalBorrow).toEqual({ amount: 0n, shares: 0n });
  });

  it("add collateral", () => {
    const p = isolatedPreview(iso({ debt: 1_000n * E6 }), { kind: "addCollateral", amount: E18 }, USDC_WETH);
    expect(p.after.ltv).toEqual({ kind: "value", ltv: 25_000n });
  });

  it("remove collateral, to zero, and over the balance (clamped, flagged invalid)", () => {
    const s = iso({ debt: 1_000n * E6 });
    expect(isolatedPreview(s, { kind: "removeCollateral", amount: E18 / 2n }, USDC_WETH).after.ltv).toEqual({ kind: "value", ltv: 100_000n });
    const zero = isolatedPreview(s, { kind: "removeCollateral", amount: E18 }, USDC_WETH);
    expect(zero.invalid).toBe(false);
    expect(zero.after.ltv).toEqual({ kind: "infinite" });
    expect(zero.after.liquidationPrice).toEqual({ kind: "now" });
    const over = isolatedPreview(s, { kind: "removeCollateral", amount: 3n * E18 }, USDC_WETH);
    expect(over.invalid).toBe(true);
    expect(over.afterState.collateral).toBe(0n);
    expect(over.after.ltv).toEqual({ kind: "infinite" });
  });

  it("isBadData keeps the LTV (adds a stale marker); R missing or 0 makes it unavailable", () => {
    const stale = isolatedRisk(iso({ debt: 1_000n * E6, isBadData: true }), USDC_WETH);
    expect(stale.stale).toBe(true);
    expect(stale.ltv).toEqual({ kind: "value", ltv: 50_000n });
    expect(isolatedLtvOf(iso({ exchangeRate: undefined }))).toEqual({ kind: "unavailable", reason: "missing-input" });
    expect(isolatedLtvOf(iso({ exchangeRate: 0n }))).toEqual({ kind: "unavailable", reason: "missing-input" });
  });
});

describe("isolated boundary table (spec §3.1, r2 #5)", () => {
  it("debt 0 → 0%, Safe, gauge 0 (even with no collateral)", () => {
    for (const collateral of [0n, E18]) {
      const l = isolatedLtvOf(iso({ debt: 0n, collateral, exchangeRate: undefined }));
      expect(l).toEqual({ kind: "value", ltv: 0n });
      expect(formatHealth({ kind: "ltv", ltv: l, maxLTV: 75_000n })).toMatchObject({ status: "safe", value: "0.00%", gauge: 0 });
    }
  });

  it("debt with zero collateral or zero maxLTV → ∞, Liquidatable, gauge 100, independent of R", () => {
    for (const s of [iso({ collateral: 0n, exchangeRate: undefined }), iso({ maxLTV: 0n, exchangeRate: undefined })]) {
      const l = isolatedLtvOf(s);
      expect(l).toEqual({ kind: "infinite" });
      expect(formatHealth({ kind: "ltv", ltv: l, maxLTV: s.maxLTV })).toMatchObject({ status: "liquidatable", value: "∞", gauge: 100 });
    }
  });
});

describe("isolated liquidation price (independent of R and isBadData)", () => {
  it("USDC/WETH: below debt / (collateral × maxLTV), in USDC per ETH", () => {
    const p = isolatedLiquidationPrice({ debt: 1_000n * E6, collateral: E18, maxLTV: 75_000n }, USDC_WETH);
    expect(p).toEqual({ kind: "below", price: 133_333_333_333n }); // 1,333.33333333
  });

  it("WETH/USDC: above collateral × maxLTV / debt", () => {
    const p = isolatedLiquidationPrice({ debt: E18 / 2n, collateral: 2_000n * E6, maxLTV: 75_000n }, WETH_USDC);
    expect(p).toEqual({ kind: "above", price: 3_000n * E8 });
  });

  it("debt 0 → none; debt with zero collateral or maxLTV → now", () => {
    expect(isolatedLiquidationPrice({ debt: 0n, collateral: 0n, maxLTV: 75_000n }, USDC_WETH)).toEqual({ kind: "none" });
    expect(isolatedLiquidationPrice({ debt: 1n, collateral: 0n, maxLTV: 75_000n }, WETH_USDC)).toEqual({ kind: "now" });
    expect(isolatedLiquidationPrice({ debt: 1n, collateral: E18, maxLTV: 0n }, USDC_WETH)).toEqual({ kind: "now" });
  });

  it("stays visible while the guard is stale and without R", () => {
    const r = isolatedRisk(iso({ debt: 1_000n * E6, isBadData: true, exchangeRate: undefined }), USDC_WETH);
    expect(r.liquidationPrice).toEqual({ kind: "below", price: 133_333_333_333n });
  });

  it("matches the pair's own solvency rule around the threshold (USDC/WETH, $1,333.33)", () => {
    // R for x USDC per ETH: 1 raw USDC buys 1e12 / x wei, × 1e18 → 1e30 / x; with x in cents: 1e32 / cents.
    const rateAtCents = (cents: bigint) => 10n ** 32n / cents;
    const at = (cents: bigint) => isolatedLtvOf({ debt: 1_000n * E6, collateral: E18, maxLTV: 75_000n, exchangeRate: rateAtCents(cents) });
    // _isSolvent floors the LTV to 1e-5, so the probes sit a few cents from the exact threshold.
    const above = at(133_340n);
    const below = at(133_300n);
    expect(above.kind === "value" && above.ltv <= 75_000n).toBe(true);
    expect(below.kind === "value" && below.ltv > 75_000n).toBe(true);
  });
});

// =============================================================================================
// formatHealth
// =============================================================================================

describe("formatHealth: thresholds, status, gauges", () => {
  const hf = (x: bigint) => formatHealth({ kind: "hf", healthFactor: x });

  it("core HF: < 1.0 liquidatable, < 1.2 danger, < 1.5 warning, else safe", () => {
    expect(hf(WAD - 1n).status).toBe("liquidatable");
    expect(hf(WAD).status).toBe("danger");
    expect(hf((12n * WAD) / 10n - 1n).status).toBe("danger");
    expect(hf((12n * WAD) / 10n).status).toBe("warning");
    expect(hf((15n * WAD) / 10n - 1n).status).toBe("warning");
    expect(hf((15n * WAD) / 10n).status).toBe("safe");
    expect(hf(MAX_HEALTH_FACTOR)).toEqual({ status: "safe", statusLabel: "Safe", value: "∞", gauge: 100 });
    expect(formatHealth({ kind: "hf", healthFactor: undefined })).toEqual({ status: "unavailable", statusLabel: "Unavailable", value: "—", gauge: 0 });
  });

  it("HF text is floored, so a liquidatable 0.999 never reads 1.00", () => {
    expect(hf((999n * WAD) / 1000n).value).toBe("0.99");
    expect(hf((1234n * WAD) / 1000n).value).toBe("1.23");
  });

  it("HF gauge spans 0–3", () => {
    expect(hf(0n).gauge).toBe(0);
    expect(hf((15n * WAD) / 10n).gauge).toBe(50);
    expect(hf(3n * WAD).gauge).toBe(100);
    expect(hf(10n * WAD).gauge).toBe(100);
  });

  it("isolated ltv/maxLTV: > 1.0 liquidatable, ≥ 0.9 danger, ≥ 0.8 warning, else safe; gauge 0–100% of maxLTV", () => {
    const l = (ltv: bigint) => formatHealth({ kind: "ltv", ltv: { kind: "value", ltv }, maxLTV: 75_000n });
    expect(l(75_001n)).toMatchObject({ status: "liquidatable", gauge: 100 });
    expect(l(75_000n)).toMatchObject({ status: "danger", value: "75.00%", gauge: 100 });
    expect(l(67_500n)).toMatchObject({ status: "danger", gauge: 90 });
    expect(l(67_499n).status).toBe("warning");
    expect(l(60_000n)).toMatchObject({ status: "warning", gauge: 80 });
    expect(l(59_999n).status).toBe("safe");
    expect(l(37_500n)).toMatchObject({ status: "safe", value: "37.50%", gauge: 50 });
    expect(formatHealth({ kind: "ltv", ltv: { kind: "unavailable", reason: "missing-input" }, maxLTV: 75_000n }).status).toBe("unavailable");
    expect(formatHealth({ kind: "ltv", ltv: { kind: "value", ltv: 10n }, maxLTV: undefined }).status).toBe("unavailable");
  });
});

// =============================================================================================
// Rates
// =============================================================================================

describe("rates", () => {
  it("aprToApy compounds per second over 31,536,000 s", () => {
    expect(aprToApy(0).isZero()).toBe(true);
    // (1 + 0.05/31,536,000)^31,536,000 − 1, close to e^0.05 − 1 = 0.0512710963760…
    const apy = aprToApy("0.05");
    expect(apy.minus("0.0512710963").abs().lt("1e-9")).toBe(true);
    expect(apy.gt("0.05")).toBe(true);
    // Small rates keep their digits.
    expect(aprToApy("1e-9").minus("1e-9").abs().lt("1e-17")).toBe(true);
  });

  it("core APY from the ray rate", () => {
    expect(rayToApr(5n * 10n ** 25n).equals("0.05")).toBe(true);
    expect(coreApy(5n * 10n ** 25n)!.equals(aprToApy("0.05"))).toBe(true);
    expect(coreApy(undefined)).toBeUndefined();
  });

  const ratePerSec = 1_585_489_599n; // ≈ 5% APR

  it("isolated borrow APR = ratePerSec × year; lend APR = borrow × utilization × (1 − fee)", () => {
    const r = isolatedAprs({ ratePerSec, feeToProtocolRate: 10_000n, totalAssetAmount: 1_000n * E6, totalBorrowAmount: 800n * E6, interestPaused: false })!;
    const borrow = new Decimal((ratePerSec * 31_536_000n).toString()).div("1e18");
    expect(r.borrowApr.equals(borrow)).toBe(true);
    expect(r.lendApr.equals(borrow.mul("0.8").mul("0.9"))).toBe(true);
  });

  it("utilization is clamped to ≤ 1 and is 0 with no assets", () => {
    const over = isolatedAprs({ ratePerSec, feeToProtocolRate: 0n, totalAssetAmount: 100n, totalBorrowAmount: 150n, interestPaused: false })!;
    expect(over.lendApr.equals(over.borrowApr)).toBe(true);
    const empty = isolatedAprs({ ratePerSec, feeToProtocolRate: 0n, totalAssetAmount: 0n, totalBorrowAmount: 0n, interestPaused: false })!;
    expect(empty.lendApr.isZero()).toBe(true);
    expect(empty.borrowApr.gt(0)).toBe(true);
  });

  it("a paused pair has 0 APRs, even though previewAddInterest returns the stale pre-pause rate", () => {
    const r = isolatedAprs({ ratePerSec, feeToProtocolRate: 10_000n, totalAssetAmount: 1_000n, totalBorrowAmount: 800n, interestPaused: true })!;
    expect(r.borrowApr.isZero()).toBe(true);
    expect(r.lendApr.isZero()).toBe(true);
    expect(aprToApy(r.borrowApr).isZero()).toBe(true);
  });

  it("an unknown pause flag or a missing rate is unavailable", () => {
    expect(isolatedAprs({ ratePerSec, feeToProtocolRate: 0n, totalAssetAmount: 1n, totalBorrowAmount: 1n, interestPaused: undefined })).toBeUndefined();
    expect(isolatedAprs({ ratePerSec: undefined, feeToProtocolRate: 0n, totalAssetAmount: 1n, totalBorrowAmount: 1n, interestPaused: false })).toBeUndefined();
  });
});

// =============================================================================================
// No division by zero anywhere
// =============================================================================================

describe("no throw on any zero divisor", () => {
  const zeros = [0n, 1n];

  it("core: zero prices, balances, thresholds and decimals", () => {
    for (const price of [0n, E8])
      for (const lt of zeros)
        for (const ltvBps of zeros)
          for (const supplied of zeros)
            for (const borrowed of zeros) {
              const s = snap(
                weth({ price, liquidationThreshold: lt * 8000n, ltv: ltvBps * 7500n, supplied, borrowed, collateralEnabled: true }),
                usdc({ price, decimals: 0, liquidationThreshold: lt * 7800n, supplied, borrowed, collateralEnabled: true }),
              );
              expect(() => coreRisk(s)).not.toThrow();
              for (const kind of ["withdraw", "repay"] as const) expect(() => corePreview(s, { kind, asset: WETH, amount: "all" })).not.toThrow();
              const d = accountData(s);
              if (d.available) expect(() => borrowLimitUsed(d as CoreAccountData)).not.toThrow();
            }
  });

  it("isolated: zero debt, collateral, maxLTV, rate, totals and shares", () => {
    for (const debt of zeros)
      for (const collateral of zeros)
        for (const maxLTV of zeros)
          for (const exchangeRate of zeros)
            for (const shares of zeros) {
              const s: IsolatedState = {
                debt,
                collateral,
                maxLTV,
                exchangeRate,
                isBadData: false,
                borrowedShares: shares,
                totalBorrow: { amount: 0n, shares: 0n },
              };
              for (const sides of [USDC_WETH, WETH_USDC]) expect(() => isolatedRisk(s, sides)).not.toThrow();
              for (const a of [
                { kind: "borrow", amount: 0n },
                { kind: "repay", amount: 1n },
                { kind: "repayShares", shares: 1n },
                { kind: "removeCollateral", amount: 1n },
              ] as const)
                expect(() => isolatedPreview(s, a, USDC_WETH)).not.toThrow();
              expect(() => formatHealth({ kind: "ltv", ltv: isolatedLtvOf(s), maxLTV })).not.toThrow();
            }
  });

  it("rates: zero totals, zero rate, fee at 100%", () => {
    expect(() => isolatedAprs({ ratePerSec: 0n, feeToProtocolRate: 100_000n, totalAssetAmount: 0n, totalBorrowAmount: 0n, interestPaused: false })).not.toThrow();
    expect(() => aprToApy(0)).not.toThrow();
    expect(() => formatHealth({ kind: "hf", healthFactor: 0n })).not.toThrow();
  });
});
