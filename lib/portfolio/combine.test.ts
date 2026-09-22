import { describe, expect, it } from "vitest";
import {
  combinePortfolio,
  lighterFreshness,
  luminaFreshness,
  luminaNetUsd,
} from "./combine";

const lumina = {
  poolSupplyUsd: 1000,
  poolDebtUsd: 200,
  isolatedSupplyUsd: 50,
  isolatedDebtUsd: 10,
  isolatedCollateralUsd: 80,
};

describe("combinePortfolio", () => {
  it("nets Lumina pool + isolated legs", () => {
    expect(luminaNetUsd(lumina)).toBe(920);
    const combined = combinePortfolio(lumina, null);
    expect(combined.totalUsd).toBe(920);
    expect(combined.netDeltaUsd).toBe(920);
    expect(combined.lighterEquityUsd).toBeNull();
  });

  it("adds Lighter equity and signed perp delta", () => {
    const combined = combinePortfolio(lumina, {
      equity: { total: 400, perps: 350, spot: 50 },
      positions: [
        { side: "long", displaySize: 2, displayMark: 100, marketId: 1, symbol: "ETH", displayAvgEntry: 90, unrealizedPnl: 20, funding: -1, marginMode: "cross" },
        { side: "short", displaySize: 1, displayMark: 50, marketId: 2, symbol: "BTC", displayAvgEntry: 55, unrealizedPnl: 5, funding: 0.5, marginMode: "isolated" },
      ],
    });
    expect(combined.lighterEquityUsd).toBe(400);
    expect(combined.lighterPerpDeltaUsd).toBe(150);
    expect(combined.totalUsd).toBe(1320);
    expect(combined.netDeltaUsd).toBe(1070);
  });
});

describe("freshness", () => {
  it("marks Lighter live from a recent websocket pong", () => {
    expect(lighterFreshness(true, 1_000, 5_000)).toBe("live");
    expect(lighterFreshness(true, 1_000, 16_000)).toBe("live");
    expect(lighterFreshness(true, 1_000, 16_001)).toBe("stale");
    expect(lighterFreshness(true, 1_000, 20_000)).toBe("stale");
    expect(lighterFreshness(false, null, 5_000)).toBe("offline");
    expect(lighterFreshness(false, 1_000, 2_000)).toBe("stale");
  });

  it("requires both on-chain positions and prices for Lumina live", () => {
    expect(luminaFreshness(true, true)).toBe("live");
    expect(luminaFreshness(true, false)).toBe("stale");
    expect(luminaFreshness(false, false)).toBe("unknown");
  });
});
