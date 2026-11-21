/**
 * ui-usability-v1 spec §3.3 / §6 #4: the "Your positions" row model, the riskiest-isolated-position
 * priority (liquidatable → unavailable → highest ltv/maxLTV by cross-multiplication) and the one
 * overall status, which is never "Safe" while any position is unknown.
 */
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { accountTotals } from "./portfolio/combine";
import { aprToApy, coreApy, MAX_HEALTH_FACTOR } from "./risk";
import {
  buildOverview,
  positionRows,
  riskiestIsolated,
  worstStatus,
  type IsolatedBorrowRow,
  type OverviewInput,
  type OverviewIsolatedPosition,
} from "./overview";

const E6 = 10n ** 6n;
const E8 = 10n ** 8n;
const E18 = 10n ** 18n;
const USDC = "0xf2A5728d366c6d0f764Af612cD47F3608E2B4d5B" as const;
const WETH = "0x660000000000000000000000000000000000000c" as const;
const P1 = "0x0000000000000000000000000000000000000200" as const; // USDC/WETH
const P2 = "0x0000000000000000000000000000000000000201" as const; // WETH/USDC
const ray = (pct: bigint) => pct * 10n ** 25n;
const hf = (x: string) => BigInt(Math.round(Number(x) * 100)) * 10n ** 16n;
const stamp = (n: bigint) => ({ number: n, timestamp: 1_700_000_000n + n });

/** USDC/WETH: lent 1,000 USDC, borrowed 500 USDC against 1 WETH (R = 0.0005 WETH per USDC) → 25% LTV. */
const usdcWeth = (over: Partial<OverviewIsolatedPosition> = {}): OverviewIsolatedPosition => ({
  pair: P1,
  asset: USDC,
  assetSymbol: "USDC",
  collateralSymbol: "WETH",
  assetDecimals: 6,
  collateralDecimals: 18,
  suppliedShares: 1_000n * E6,
  borrowedShares: 500n * E6,
  collateralAmount: E18,
  suppliedAssets: 1_000n * E6,
  borrowedAssets: 500n * E6,
  maxLTV: 75_000n,
  exchangeRate: 5n * 10n ** 26n,
  oracleBadData: false,
  lendApr: new Decimal("0.03"),
  borrowApr: new Decimal("0.06"),
  ...over,
});

/** WETH/USDC: collateral only (3,000 USDC posted, debt repaid; R = 2,000 USDC per WETH). */
const wethUsdc = (over: Partial<OverviewIsolatedPosition> = {}): OverviewIsolatedPosition => ({
  pair: P2,
  asset: WETH,
  assetSymbol: "WETH",
  collateralSymbol: "USDC",
  assetDecimals: 18,
  collateralDecimals: 6,
  suppliedShares: 0n,
  borrowedShares: 0n,
  collateralAmount: 3_000n * E6,
  suppliedAssets: 0n,
  borrowedAssets: 0n,
  maxLTV: 75_000n,
  exchangeRate: 2n * 10n ** 9n,
  oracleBadData: false,
  lendApr: new Decimal("0.01"),
  borrowApr: new Decimal("0.04"),
  ...over,
});

function input(over: Partial<OverviewInput> = {}, iso: Partial<OverviewInput["isolated"]> = {}): OverviewInput {
  return {
    core: {
      positions: [
        { asset: WETH, symbol: "WETH", decimals: 18, supplied: 0n, borrowed: E18, collateralEnabled: false },
        { asset: USDC, symbol: "USDC", decimals: 6, supplied: 10_000n * E6, borrowed: 0n, collateralEnabled: true },
      ],
      healthFactor: hf("3.9"),
      eMode: 0n,
      stamp: stamp(10n),
      loading: false,
    },
    markets: [
      { asset: WETH, supplyRate: ray(2n), borrowRate: ray(4n), config: { ltv: 7500, liquidationThreshold: 8000 } },
      { asset: USDC, supplyRate: ray(5n), borrowRate: ray(8n), config: { ltv: 7500, liquidationThreshold: 7800 } },
    ],
    priceOf: (a) => (a.toLowerCase() === USDC.toLowerCase() ? E8 : a.toLowerCase() === WETH.toLowerCase() ? 2_000n * E8 : undefined),
    pricesStamp: stamp(9n),
    isolated: {
      positions: [usdcWeth(), wethUsdc()],
      unknownPairs: [],
      incomplete: false,
      loading: false,
      stamps: { snapshots: stamp(12n), conversions: stamp(11n), pairs: stamp(13n) },
      ...iso,
    },
    pairLabel: (p) => (p === P1.toLowerCase() ? "USDC/WETH" : p === P2.toLowerCase() ? "WETH/USDC" : p),
    loading: false,
    ...over,
  };
}

const borrowRow = (rows: ReturnType<typeof positionRows>, pair: string) =>
  rows.find((r): r is IsolatedBorrowRow => r.kind === "isolatedBorrow" && r.pair === pair)!;

describe("positionRows: the row model (spec §3.3)", () => {
  it("core supply, core borrow, isolated lend and isolated borrow/collateral rows, incl. collateral-only", () => {
    const rows = positionRows(input());
    expect(rows.map((r) => `${r.kind}:${"symbol" in r ? r.symbol : "label" in r ? r.label : ""}`)).toEqual([
      "coreSupply:USDC",
      "coreBorrow:WETH",
      "isolatedLend:USDC/WETH",
      "isolatedBorrow:USDC/WETH",
      "isolatedBorrow:WETH/USDC",
    ]);
  });

  it("each row carries USD (oracle price, 8 decimals) and APY (aprToApy)", () => {
    const rows = positionRows(input());
    const supply = rows.find((r) => r.kind === "coreSupply")!;
    expect(supply).toMatchObject({ amount: 10_000n * E6, usd: 10_000n * E8, collateralEnabled: true });
    expect(supply.kind === "coreSupply" && supply.apy!.equals(coreApy(ray(5n))!)).toBe(true);
    const debt = rows.find((r) => r.kind === "coreBorrow")!;
    expect(debt).toMatchObject({ amount: E18, usd: 2_000n * E8 });
    expect(debt.kind === "coreBorrow" && debt.health.value).toBe("3.90");
    const lend = rows.find((r) => r.kind === "isolatedLend")!;
    expect(lend.kind === "isolatedLend" && lend.apy!.equals(aprToApy("0.03"))).toBe(true);

    const iso = borrowRow(rows, P1);
    expect(iso.debt.usd).toBe(500n * E8);
    expect(iso.debt.apy!.equals(aprToApy("0.06"))).toBe(true);
    expect(iso.collateral.usd).toBe(2_000n * E8);
    expect(iso.ltv).toEqual({ kind: "value", ltv: 25_000n });
    expect(iso.health.status).toBe("safe");
    // 500 USDC debt, 1 WETH, 75% max → below 666.66… USDC per ETH.
    expect(iso.liquidationPrice).toEqual({ kind: "below", price: 66_666_666_666n });
  });

  it("a collateral-only position (debt repaid) still has its row: no debt, 0% LTV, Safe, liquidation price none", () => {
    const only = borrowRow(positionRows(input()), P2);
    expect(only.hasDebt).toBe(false);
    expect(only.collateral).toEqual({ amount: 3_000n * E6, usd: 3_000n * E8 });
    expect(only.health).toMatchObject({ status: "safe", value: "0.00%" });
    expect(only.liquidationPrice).toEqual({ kind: "none" });
  });

  it("a failed read is an 'unavailable' row, never a missing one or a 0 balance", () => {
    const rows = positionRows(
      input(
        {
          core: {
            ...input().core,
            positions: [{ asset: USDC, symbol: "USDC", decimals: 6, supplied: undefined, borrowed: undefined, collateralEnabled: undefined }],
          },
        },
        { unknownPairs: [P2.toLowerCase()], positions: [usdcWeth()] },
      ),
    );
    expect(rows.filter((r) => r.kind === "unavailable").map((r) => r.kind === "unavailable" && `${r.venue}:${r.label}`)).toEqual([
      "core:USDC",
      "isolated:WETH/USDC",
    ]);
    expect(rows.some((r) => r.kind === "coreSupply")).toBe(false);
  });

  it("a stale pair oracle keeps the LTV and adds the marker; a failed conversion reads unavailable, not 0", () => {
    const stale = borrowRow(positionRows(input({}, { positions: [usdcWeth({ oracleBadData: true })] })), P1);
    expect(stale.stale).toBe(true);
    expect(stale.ltv).toEqual({ kind: "value", ltv: 25_000n });
    const noConv = borrowRow(positionRows(input({}, { positions: [usdcWeth({ borrowedAssets: undefined })] })), P1);
    expect(noConv.debt.amount).toBeUndefined();
    expect(noConv.debt.usd).toBeUndefined();
    expect(noConv.health.status).toBe("unavailable");
  });
});

describe("riskiestIsolated: the priority order (spec §3.3, r1 #14.1)", () => {
  const pick = (positions: OverviewIsolatedPosition[], unknownPairs: string[] = []) => {
    const i = input({}, { positions, unknownPairs });
    return riskiestIsolated(positionRows(i), unknownPairs, i.pairLabel);
  };

  it("3: the highest ltv/maxLTV by cross-multiplication, not the highest LTV", () => {
    // P1: 60% LTV at a 90% max (0.67 of max). P2: 50% LTV at a 55% max (0.91 of max): riskier.
    const a = usdcWeth({ borrowedAssets: 1_200n * E6, maxLTV: 90_000n });
    const b = wethUsdc({ borrowedShares: 1n, borrowedAssets: (3n * E18) / 4n, maxLTV: 55_000n });
    const p = pick([a, b]);
    expect(p.kind === "position" && [p.priority, p.row.label, p.row.health.status]).toEqual(["highest", "WETH/USDC", "danger"]);
    expect(p.kind === "position" && p.row.ltv).toEqual({ kind: "value", ltv: 50_000n });
    // Order-independent.
    const q = pick([b, a]);
    expect(q.kind === "position" && q.row.label).toBe("WETH/USDC");
  });

  it("1: a liquidatable position outranks an unknown pair and a higher ratio", () => {
    // LTV > max.
    const over = usdcWeth({ maxLTV: 20_000n });
    const p = pick([wethUsdc(), over], [P2.toLowerCase()]);
    expect(p.kind === "position" && [p.priority, p.row.label, p.row.health.status]).toEqual(["liquidatable", "USDC/WETH", "liquidatable"]);
    // Debt with zero collateral: ∞, liquidatable, whatever R is.
    const naked = usdcWeth({ collateralAmount: 0n, exchangeRate: undefined });
    const q = pick([naked], [P2.toLowerCase()]);
    expect(q.kind === "position" && [q.priority, q.row.health.value]).toEqual(["liquidatable", "∞"]);
    // Debt with maxLTV 0: liquidatable too.
    const zeroMax = pick([usdcWeth({ maxLTV: 0n })]);
    expect(zeroMax.kind === "position" && zeroMax.priority).toBe("liquidatable");
  });

  it("2: an unknown pair (snapshot failed) or an unreadable position outranks a known ratio", () => {
    const risky = usdcWeth({ borrowedAssets: 700n * E6 }); // 35% of 75%: Warning-free but known
    const unknown = pick([risky], [P2.toLowerCase()]);
    expect(unknown).toEqual({ kind: "unknown", pair: P2.toLowerCase(), label: "WETH/USDC" });
    const noRate = pick([risky, wethUsdc({ borrowedShares: 1n, borrowedAssets: E18 / 10n, exchangeRate: undefined })]);
    expect(noRate.kind === "position" && [noRate.priority, noRate.row.label]).toEqual(["unavailable", "WETH/USDC"]);
  });

  it("no borrow or collateral position: none", () => {
    expect(pick([usdcWeth({ borrowedShares: 0n, borrowedAssets: 0n, collateralAmount: 0n })])).toEqual({ kind: "none" });
  });
});

describe("overall status: one status, never 'Safe' while anything is unknown (r2 table #14)", () => {
  it("all known and healthy: the worst of core and the riskiest isolated position", () => {
    expect(buildOverview(input()).risk.status).toBe("safe");
    const warn = buildOverview(input({ core: { ...input().core, healthFactor: hf("1.3") } }));
    expect(warn.risk.status).toBe("warning");
  });

  it("an unknown pair (unknownPairs) → Unavailable, not Safe", () => {
    const o = buildOverview(input({}, { unknownPairs: [P2.toLowerCase()], positions: [usdcWeth()], incomplete: true }));
    expect(o.risk.isolated.kind).toBe("unknown");
    expect(o.risk.status).toBe("unavailable");
  });

  it("missing core data → Unavailable, not Safe: on-chain HF unreadable, eMode unreadable or non-zero, a price missing", () => {
    const noHf = buildOverview(input({ core: { ...input().core, healthFactor: undefined } }));
    expect(noHf.risk.core.status).toBe("unavailable");
    expect(noHf.risk.status).toBe("unavailable");
    const noEMode = buildOverview(input({ core: { ...input().core, eMode: undefined } }));
    expect(noEMode.risk.core.liquidationPrice).toEqual({ kind: "unavailable", reason: "missing-input" });
    expect(noEMode.risk.status).toBe("unavailable");
    const eMode = buildOverview(input({ core: { ...input().core, eMode: 1n } }));
    expect(eMode.risk.status).toBe("unavailable");
    const noPrice = buildOverview(input({ priceOf: () => undefined }));
    expect(noPrice.risk.status).toBe("unavailable");
  });

  it("a known liquidatable position wins over unknown data; loading reads 'loading' otherwise", () => {
    const coreLiq = buildOverview(input({ core: { ...input().core, healthFactor: hf("0.95"), eMode: undefined } }));
    expect(coreLiq.risk.status).toBe("liquidatable");
    const isoLiq = buildOverview(input({ loading: true }, { positions: [usdcWeth({ maxLTV: 20_000n })], unknownPairs: [P2.toLowerCase()] }));
    expect(isoLiq.risk.status).toBe("liquidatable");
    expect(buildOverview(input({ loading: true })).risk.status).toBe("loading");
  });

  it("core risk: the on-chain HF, and the liquidation price from the per-reserve account data", () => {
    const { core } = buildOverview(input()).risk;
    expect(core.health).toMatchObject({ value: "3.90", status: "safe" });
    // 10,000 USDC at 78% LT against 1 WETH debt: liquidatable above $7,800 per ETH.
    expect(core.liquidationPrice).toEqual({ kind: "above", price: 7_800n * E8 });
    const none = buildOverview(input({ core: { ...input().core, healthFactor: MAX_HEALTH_FACTOR, positions: [input().core.positions[1]] } }));
    expect(none.risk.core.liquidationPrice).toEqual({ kind: "none" });
  });

  it("worstStatus ranks liquidatable > unavailable > danger > warning > safe", () => {
    expect(worstStatus(["safe", "danger", "unavailable"])).toBe("unavailable");
    expect(worstStatus(["unavailable", "liquidatable"])).toBe("liquidatable");
    expect(worstStatus(["warning", "danger"])).toBe("danger");
    expect(worstStatus([])).toBe("safe");
  });
});

describe("buildOverview totals come from accountTotals()", () => {
  it("are exactly accountTotals() over the same reads (incl. the combined stamp)", () => {
    const i = input();
    const direct = accountTotals({
      core: i.core.positions,
      coreRatesOf: (a) => {
        const m = i.markets.find((x) => x.asset.toLowerCase() === a.toLowerCase());
        return m && { supplyRate: m.supplyRate, borrowRate: m.borrowRate };
      },
      isolated: i.isolated.positions,
      priceOf: i.priceOf,
      isolatedIncomplete: false,
      stamps: { core: stamp(10n), prices: stamp(9n), isolated: stamp(12n), conversions: stamp(11n), pairs: stamp(13n) },
    });
    const { totals } = buildOverview(i);
    expect(totals).toEqual(direct);
    // 10,000 + 1,000 + 2,000 + 3,000 − 2,000 − 500
    expect(totals.netWorth).toBe(13_500n * E8);
    expect(totals.stamp).toEqual(stamp(9n));
  });

  it("isolated loading or incomplete → isolated legs and the totals unavailable", () => {
    expect(buildOverview(input({}, { loading: true })).totals.netWorth).toBeUndefined();
    const inc = buildOverview(input({}, { incomplete: true }));
    expect(inc.totals.incomplete).toBe(true);
    expect(inc.totals.deposits).toBeUndefined();
  });
});
