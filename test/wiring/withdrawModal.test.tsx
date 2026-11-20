// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ALICE, fake, resetFake, update, useFakeVersion } from "../support/fakeChain";
import { POOL, USDC } from "../support/deployment";
import { AAVE_ENTIRE_BALANCE } from "@/lib/approvals";

vi.mock("@/hooks/chain", async () => (await import("../support/fakeChain")).chainModule);
vi.mock("wagmi", async () => (await import("../support/fakeChain")).wagmiModule);
vi.mock("@/lib/deployments", async (importOriginal) => (await import("../support/mockDeployments")).mockDeployments(importOriginal));
vi.mock("@/hooks/useUserPosition", () => ({
  useUserPosition: () => {
    useFakeVersion();
    return {
      positions: [
        { asset: USDC, symbol: "USDC", decimals: 6, supplied: fake.data.supplied, borrowed: 0n, collateral: 0n, collateralEnabled: false },
      ],
      accountData: undefined,
      stamp: undefined,
    };
  },
}));
vi.mock("@/hooks/useOraclePrices", () => ({ useOraclePrices: () => ({ priceOf: () => 10n ** 8n }) }));
vi.mock("@/hooks/useAllMarkets", () => ({ useAllMarkets: () => ({ getMarket: () => undefined }) }));

import { WithdrawModal } from "@/components/actions/WithdrawModal";

beforeEach(() => {
  resetFake();
  fake.data.supplied = 100_000_000n;
});
afterEach(() => cleanup());

describe("WithdrawModal: 'withdraw all' intent (Codex #5)", () => {
  it("balance refreshes 100 → 100.000001 after MAX: the tx still sends uint256.max", async () => {
    render(<WithdrawModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    await act(async () => update((f) => (f.data.supplied = 100_000_001n)));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Withdraw USDC" })));
    expect(fake.sends.at(-1)).toMatchObject({ functionName: "withdraw", address: POOL, args: [USDC, AAVE_ENTIRE_BALANCE, ALICE] });
  });

  it("a typed amount is sent as a finite number", async () => {
    render(<WithdrawModal asset={USDC} symbol="USDC" decimals={6} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "100" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Withdraw USDC" })));
    expect(fake.sends.at(-1)?.args).toEqual([USDC, 100_000_000n, ALICE]);
  });
});
