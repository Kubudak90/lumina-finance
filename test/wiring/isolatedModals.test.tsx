// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ALICE, fake, resetFake, setRead, update, useFakeVersion } from "../support/fakeChain";
import { PAIR_USDC_WETH, USDC, WETH } from "../support/deployment";
import { describeGuardStatus } from "@/lib/guard";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("@/hooks/useIsolatedPairs", () => ({
  useIsolatedPair: () => {
    useFakeVersion();
    return fake.data.pair;
  },
}));
vi.mock("@/hooks/useUserIsolatedPositions", () => ({
  useIsolatedPosition: () => {
    useFakeVersion();
    return fake.data.position;
  },
}));
vi.mock("@/hooks/useGuardStatus", () => ({
  useGuardStatus: () => {
    useFakeVersion();
    return { ...(fake.data.guard as object), isLoading: false };
  },
}));

import { IsolatedBorrowModal } from "@/components/actions/IsolatedBorrowModal";
import { IsolatedRepayModal } from "@/components/actions/IsolatedRepayModal";

const BOUNDS = { maxRefAgeSec: 180, maxDeviationBps: 300, maxCorePriceAgeSec: 600 };

const pairInfo = {
  name: "USDC/WETH",
  pair: PAIR_USDC_WETH,
  asset: USDC,
  collateral: WETH,
  assetSymbol: "USDC",
  collateralSymbol: "WETH",
  assetDecimals: 6,
  collateralDecimals: 18,
  dualOracle: null,
  deployed: true,
  maxLTV: 75_000n,
  totalAssetAmount: 1_000_000_000_000n,
  totalAssetShares: 1_000_000_000_000n,
  totalBorrowAmount: 0n,
  totalBorrowShares: 0n,
  totalCollateral: 0n,
  borrowLimit: (1n << 200n) - 1n,
  availableLiquidity: 1_000_000_000_000n,
  utilization: 0,
  exchangeRate: 5n * 10n ** 26n, // ETH = $2000
  oracleBadData: false as boolean | undefined,
  loaded: true,
};

const position = (borrowedShares: bigint, borrowedAssets: bigint | undefined) => ({
  ...pairInfo,
  suppliedShares: 0n,
  suppliedAssets: 0n,
  borrowedShares,
  borrowedAssets,
  collateralAmount: 10n ** 18n,
});

beforeEach(() => {
  resetFake();
  fake.data.pair = pairInfo;
  fake.data.position = position(0n, 0n);
  fake.data.guard = describeGuardStatus(0, 0, BOUNDS);
  setRead(USDC, "balanceOf", 10_000_000_000n);
  setRead(WETH, "balanceOf", 10n ** 18n);
  setRead(USDC, "allowance", 10n ** 15n);
  setRead(WETH, "allowance", 10n ** 18n);
});
afterEach(() => cleanup());

describe("IsolatedBorrowModal follows the polled guard (Codex #8)", () => {
  it("the guard turns stale while the modal is open → Borrow is disabled", async () => {
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "100" } });
    expect((screen.getByRole("button", { name: "Borrow USDC" }) as HTMLButtonElement).disabled).toBe(false);

    // Next poll: keeper reference stale; the pair oracle flags bad data.
    await act(async () =>
      update((f) => {
        f.data.guard = describeGuardStatus(4, 0, BOUNDS);
        f.data.pair = { ...pairInfo, oracleBadData: true };
      }),
    );
    const blocked = screen.getByRole("button", { name: "Borrowing blocked" }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
  });

  it("a guard-only transition (oracle flag not yet refreshed) also disables Borrow", async () => {
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "100" } });
    await act(async () => update((f) => (f.data.guard = describeGuardStatus(4, 0, BOUNDS))));
    expect((screen.getByRole("button", { name: "Borrowing blocked" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("re-validates after the collateral approval: no borrow if the guard tripped meanwhile", async () => {
    setRead(WETH, "allowance", 0n);
    render(<IsolatedBorrowModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Collateral"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Borrow"), { target: { value: "100" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve WETH" })));
    expect(fake.sends[0].args).toEqual([PAIR_USDC_WETH, 5n * 10n ** 17n]); // exact collateral
    await act(async () => update((f) => (f.data.guard = describeGuardStatus(4, 0, BOUNDS))));
    await act(async () => {
      setRead(WETH, "allowance", 5n * 10n ** 17n);
      update((f) => f.receipts.set(`0x${"1".padStart(64, "0")}`, "success"));
    });
    expect(fake.sends.map((s) => s.functionName)).toEqual(["approve"]);
  });
});

describe("IsolatedRepayModal uses the current shares (Codex #8)", () => {
  it("shares drop from 100 to 50 while open → MAX repays 50", async () => {
    fake.data.position = position(100n, 100_000_000n);
    setRead(PAIR_USDC_WETH, "toBorrowAmount", 100_000_000n);
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));

    // Another session repaid half; the next poll shows 50 shares.
    await act(async () =>
      update((f) => {
        f.data.position = position(50n, 50_000_000n);
        f.reads.set(`${PAIR_USDC_WETH.toLowerCase()}:toBorrowAmount`, 50_000_000n);
      }),
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Repay USDC" })));
    await act(async () => {});
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "repayAsset", args: [50n, ALICE] });
  });

  it("says the typed amount is an estimate before approval (Codex #6)", () => {
    fake.data.position = position(100n, 100_000_000n);
    render(<IsolatedRepayModal pair={PAIR_USDC_WETH} onClose={() => {}} />);
    expect(screen.getByTestId("share-estimate").textContent).toMatch(/Estimate/);
  });
});
