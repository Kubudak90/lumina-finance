// @vitest-environment happy-dom
/**
 * U4 review r1 #4: closing a dialog while its follow-up awaits a read opens no wallet prompt, even
 * when the read resolves in the post-commit window — after the closing commit, before React runs
 * the passive (useEffect) cleanups. The modals' "mounted" flags flip in a layout effect, at the
 * commit itself. The dialogs here are closed OUTSIDE act() by a scheduled update (see
 * test/support/closable.tsx); each test also proves the window was really open (the probe saw no
 * passive cleanup yet when the resumed read continued).
 *
 * The dialog shell is a plain container here: Base UI's Dialog happens to schedule a synchronous
 * update when it unmounts, which makes React flush the passive cleanups inside the closing commit
 * and so hides the window. The modals' guards must not depend on that library detail.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { ALICE, fake, hashOf, holdReads, mine, resetFake, setRead, useFakeVersion } from "../support/fakeChain";
import { DUAL_USDC_WETH, PAIR_USDC_WETH, USDC, WETH } from "../support/deployment";
import { defaultTxChain, txChain, type TxChainState } from "../support/txChain";
import { renderClosable } from "../support/closable";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("next/link", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {}, warning: () => {} } }));
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
    DialogContent: Box,
    DialogHeader: Box,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  };
});
vi.mock("@/hooks/useIsolatedPairs", () => ({
  useIsolatedPair: () => {
    useFakeVersion();
    return fake.data.pair;
  },
}));

import { SupplyModal } from "@/components/actions/SupplyModal";
import { IsolatedWithdrawModal } from "@/components/actions/IsolatedWithdrawModal";

const lc = (a: string) => a.toLowerCase();
const pairInfo = {
  name: "USDC/WETH",
  pair: PAIR_USDC_WETH,
  asset: USDC,
  collateral: WETH,
  assetSymbol: "USDC",
  collateralSymbol: "WETH",
  assetDecimals: 6,
  collateralDecimals: 18,
  dualOracle: DUAL_USDC_WETH,
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
  exchangeRate: 5n * 10n ** 26n,
  oracleBadData: false as boolean | undefined,
  loaded: true,
};

let chain: TxChainState;

beforeEach(() => {
  resetFake();
  chain = defaultTxChain();
  chain.accounts[lc(ALICE)] = { supplied: { [lc(WETH)]: 10n ** 18n }, borrowed: {}, collateral: { [lc(WETH)]: true } };
  fake.multicall = txChain(chain);
  fake.data.pair = pairInfo;
  setRead(USDC, "balanceOf", 10_000_000_000n);
  setRead(USDC, "allowance", 0n);
});
afterEach(() => cleanup());

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const sent = () => fake.sends.map((s) => s.functionName);

describe("closing the dialog in the post-commit window sends nothing", () => {
  it("useApprovalFlow: step 2's re-check resolves right after the closing commit → no supply (mountedRef flips at commit)", async () => {
    let release: () => void = () => {};
    const dialog = renderClosable(<SupplyModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />, () => release());
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1.5" } });
    await act(async () => fireEvent.click(button("Approve USDC")));
    release = holdReads(); // step 2's wallet re-check (wallet.fetchNow) waits here
    await act(async () => setRead(USDC, "allowance", 1_500_000n));
    await act(async () => mine(hashOf(1)));
    expect(screen.getByTestId("tx-step-2").dataset.state).toBe("checking");

    await dialog.closeOutsideAct(); // the held read is released in the closing commit's layout phase

    expect(dialog.probe.passiveRanBeforeCommitMicrotasks).toBe(false); // the window was open
    expect(sent()).toEqual(["approve"]);
  });

  it("IsolatedWithdraw MAX: the share-balance read resolves right after the closing commit → no redeem", async () => {
    setRead(PAIR_USDC_WETH, "maxWithdraw", 100_000_000n);
    chain.snapshots[lc(ALICE)] = [95_000_000n, 0n, 0n];
    chain.maxRedeem = 95_000_000n;
    let release: () => void = () => {};
    const dialog = renderClosable(<IsolatedWithdrawModal pair={PAIR_USDC_WETH} onClose={() => {}} />, () => release());
    fireEvent.click(button("MAX"));
    release = holdReads(); // MAX's readNow (share balance, maxRedeem) waits here
    await act(async () => fireEvent.click(button("Withdraw USDC")));
    expect(fake.freshReads).toHaveLength(0); // still held

    await dialog.closeOutsideAct();

    expect(dialog.probe.passiveRanBeforeCommitMicrotasks).toBe(false); // the window was open
    expect(fake.freshReads.map((c) => c.functionName)).toEqual(["getUserSnapshot", "maxRedeem"]); // the read did resolve
    expect(sent()).toEqual([]);
  });

  it("control: the same flow, not closed, does send (the held read is what the tests above release)", async () => {
    setRead(PAIR_USDC_WETH, "maxWithdraw", 100_000_000n);
    chain.snapshots[lc(ALICE)] = [95_000_000n, 0n, 0n];
    chain.maxRedeem = 95_000_000n;
    renderClosable(<IsolatedWithdrawModal pair={PAIR_USDC_WETH} onClose={() => {}} />, () => {});
    fireEvent.click(button("MAX"));
    const release = holdReads();
    await act(async () => fireEvent.click(button("Withdraw USDC")));
    await act(async () => release());
    await act(async () => {});
    expect(sent()).toEqual(["redeem"]);
  });
});
