// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resetFake } from "../support/fakeChain";
import { PAIR_USDC_WETH, PAIR_WETH_USDC, USDC, WETH } from "../support/deployment";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("@/lib/chains", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chains")>()),
  rpcUrlFor: () => "https://rpc.test",
}));
vi.mock("@/hooks/useGuardStatus", () => ({ useGuardStatus: () => ({ key: "OK", borrowAllowed: true, message: "", marketId: 0, isLoading: false }) }));
vi.mock("@/lib/portfolio/clock", () => ({ useFreshnessNow: () => 1_700_000_100_000 }));

const pair = (address: `0x${string}`, asset: string, collateral: string, assetSymbol: string, collateralSymbol: string) => ({
  name: `${assetSymbol}/${collateralSymbol}`,
  pair: address,
  asset,
  collateral,
  assetSymbol,
  collateralSymbol,
  assetDecimals: assetSymbol === "USDC" ? 6 : 18,
  collateralDecimals: collateralSymbol === "USDC" ? 6 : 18,
  dualOracle: null,
  deployed: true,
  maxLTV: 75_000n,
  totalAssetAmount: 0n,
  totalAssetShares: 0n,
  totalBorrowAmount: 0n,
  totalBorrowShares: 0n,
  totalCollateral: 0n,
  borrowLimit: 0n,
  availableLiquidity: 0n,
  utilization: 0,
  exchangeRate: undefined,
  oracleBadData: false,
  loaded: true,
});

vi.mock("@/hooks/useIsolatedPairs", () => ({
  useIsolatedPairs: () => ({
    pairs: [pair(PAIR_USDC_WETH, USDC, WETH, "USDC", "WETH"), pair(PAIR_WETH_USDC, WETH, USDC, "WETH", "USDC")],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useUserIsolatedPositions", () => ({
  useUserIsolatedPositions: () => ({
    positions: [],
    incomplete: true,
    unknownPairs: [PAIR_WETH_USDC.toLowerCase()],
    knownPairs: new Set([PAIR_USDC_WETH.toLowerCase()]),
    // snapshot fresh (block 1050), conversions and pair rates older (block 1000)
    stamp: { number: 1_050n, timestamp: 1_700_000_090n },
    conversionStamp: { number: 1_000n, timestamp: 1_700_000_040n },
    pairsStamp: { number: 1_020n, timestamp: 1_700_000_060n },
    isLoading: false,
  }),
}));

import IsolatedPage from "@/app/(app)/isolated/page";

beforeEach(() => resetFake());
afterEach(() => cleanup());

describe("isolated page freshness and incomplete rows (Gemini r2 m2)", () => {
  it("stamps the table with the OLDEST of the snapshot, conversion and pair blocks", () => {
    render(<IsolatedPage />);
    expect(screen.getByText(/as of block 1000 · 60s ago/)).toBeTruthy();
    expect(screen.queryByText(/as of block 1050/)).toBeNull();
  });

  it("flags a pair whose snapshot failed instead of dropping it", () => {
    render(<IsolatedPage />);
    const rows = screen.getAllByTestId("unknown-position-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toMatch(/WETH\/USDC/);
    expect(rows[0].textContent).toMatch(/Position unavailable/);
    expect(screen.queryByText(/No active positions/)).toBeNull();
  });
});
