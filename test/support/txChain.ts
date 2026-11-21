/**
 * A scripted chain for the transaction-flow wiring tests (ui-usability-v1 U2): answers the core
 * position / market / price multicalls, the guard, the isolated account reads and the block stamp
 * from one mutable state, so a test can move the chain (and its block) between renders.
 */
import type { CallResult, ContractCall } from "./fakeChain";
import { STRATEGY, USDC, WETH, fake as addr } from "./deployment";

const ok = (result: unknown): CallResult => ({ status: "success", result });
const fail = (why: string): CallResult => ({ status: "failure", error: new Error(why) });

// markets.core[0] = WETH, [1] = USDC → aTokens fake(0x400 + i), variable debt tokens fake(0x500 + i).
export const A_WETH = addr(0x400);
export const A_USDC = addr(0x401);
export const D_WETH = addr(0x500);
export const D_USDC = addr(0x501);

const lc = (a: unknown) => String(a ?? "").toLowerCase();

export interface CoreAccount {
  supplied: Record<string, bigint>;
  borrowed: Record<string, bigint>;
  collateral: Record<string, boolean>;
  /** getUserAccountData()[5]; defaults to no debt (uint256 max). */
  healthFactor?: bigint;
  /** The whole getUserAccountData tuple, when a test needs more than the HF. */
  accountData?: readonly bigint[];
}

export interface TxChainState {
  block: bigint;
  timestamp: bigint;
  /** getBlockNumber fails (stamps unreadable). */
  stampFails?: boolean;
  eMode: bigint;
  accounts: Record<string, CoreAccount>;
  prices: Record<string, bigint>;
  config: Record<string, { ltv: bigint; lt: bigint; bonus: bigint; decimals: bigint }>;
  rates: Record<string, { supply: bigint; borrow: bigint }>;
  guardStatus: number;
  /** Isolated: getUserSnapshot by account; accounting; maxLTV; dual oracle (badData, low, high). */
  snapshots: Record<string, readonly [bigint, bigint, bigint]>;
  accounting: readonly [bigint, bigint, bigint, bigint, bigint];
  maxLtv: bigint;
  oracle: readonly [boolean, bigint, bigint];
  /** toBorrowAmount(shares) = shares × perShare. */
  perShare: bigint;
  /** ERC-20 balanceOf / allowance answered to fresh (multicall) reads. */
  wallet: bigint;
  allowance: bigint;
  /** pair.maxRedeem(owner). */
  maxRedeem: bigint;
}

export const MAX_HF = (1n << 256n) - 1n;
const E8 = 10n ** 8n;

export function defaultTxChain(): TxChainState {
  return {
    block: 100n,
    timestamp: 1_700_000_000n,
    eMode: 0n,
    accounts: {},
    prices: { [lc(WETH)]: 2_000n * E8, [lc(USDC)]: 1n * E8 },
    config: {
      [lc(WETH)]: { ltv: 7_500n, lt: 8_000n, bonus: 10_500n, decimals: 18n },
      [lc(USDC)]: { ltv: 7_500n, lt: 7_800n, bonus: 10_500n, decimals: 6n },
    },
    // 3% supply, 5% borrow (ray).
    rates: {
      [lc(WETH)]: { supply: 3n * 10n ** 25n, borrow: 5n * 10n ** 25n },
      [lc(USDC)]: { supply: 3n * 10n ** 25n, borrow: 5n * 10n ** 25n },
    },
    guardStatus: 0,
    snapshots: {},
    accounting: [1_000_000_000_000n, 1_000_000_000_000n, 0n, 0n, 0n],
    maxLtv: 75_000n,
    oracle: [false, 5n * 10n ** 26n, 5n * 10n ** 26n],
    perShare: 1_000_000n,
    wallet: 10n ** 24n,
    allowance: 10n ** 24n,
    maxRedeem: 0n,
  };
}

const ATOKENS: Record<string, string> = { [lc(A_WETH)]: lc(WETH), [lc(A_USDC)]: lc(USDC) };
const DEBT_TOKENS: Record<string, string> = { [lc(D_WETH)]: lc(WETH), [lc(D_USDC)]: lc(USDC) };

export function txChain(state: TxChainState) {
  const account = (who: unknown): CoreAccount => state.accounts[lc(who)] ?? { supplied: {}, borrowed: {}, collateral: {} };
  return (calls: readonly ContractCall[]): readonly CallResult[] =>
    calls.map((c) => {
      const a0 = c.args?.[0];
      switch (c.functionName) {
        case "getBlockNumber":
          return state.stampFails ? fail("no multicall3") : ok(state.block);
        case "getCurrentBlockTimestamp":
          return state.stampFails ? fail("no multicall3") : ok(state.timestamp);
        case "getUserAccountData":
          return ok(account(a0).accountData ?? [0n, 0n, 0n, 0n, 0n, account(a0).healthFactor ?? MAX_HF]);
        case "balanceOf": {
          const token = lc(c.address);
          if (ATOKENS[token]) return ok(account(a0).supplied[ATOKENS[token]] ?? 0n);
          if (DEBT_TOKENS[token]) return ok(account(a0).borrowed[DEBT_TOKENS[token]] ?? 0n);
          return ok(state.wallet);
        }
        case "getUserReserveData": {
          const acc = account(c.args?.[1]);
          const asset = lc(a0);
          return ok([acc.supplied[asset] ?? 0n, 0n, acc.borrowed[asset] ?? 0n, 0n, 0n, 0n, 0n, 0, acc.collateral[asset] ?? false]);
        }
        case "getUserEMode":
          return ok(state.eMode);
        case "getReserveData": {
          const r = state.rates[lc(a0)];
          return r
            ? ok({ currentLiquidityRate: r.supply, currentVariableBorrowRate: r.borrow, accruedToTreasury: 0n, interestRateStrategyAddress: STRATEGY })
            : fail("no reserve");
        }
        case "totalSupply":
        case "getTotalDebt":
          return ok(0n);
        case "getVirtualUnderlyingBalance":
          return ok(10n ** 30n);
        case "getReserveCaps":
          return ok([0n, 0n]);
        case "getReserveConfigurationData": {
          const cfg = state.config[lc(a0)];
          return cfg ? ok([cfg.decimals, cfg.ltv, cfg.lt, cfg.bonus, 1_000n, true, true, false, true, false]) : fail("no config");
        }
        case "getPaused":
          return ok(false);
        case "getAssetPrice":
          return state.prices[lc(a0)] !== undefined ? ok(state.prices[lc(a0)]) : fail("no price");
        case "borrowStatus":
          return ok([state.guardStatus, 0]);
        case "getUserSnapshot":
          return ok(state.snapshots[lc(a0)] ?? [0n, 0n, 0n]);
        case "getPairAccounting":
          return ok(state.accounting);
        case "maxLTV":
          return ok(state.maxLtv);
        case "getPrices":
          return ok(state.oracle);
        case "toBorrowAmount":
          return ok((a0 as bigint) * state.perShare);
        case "borrowLimit":
          return ok((1n << 200n) - 1n);
        case "allowance":
          return ok(state.allowance);
        case "maxRedeem":
          return ok(state.maxRedeem);
        default:
          return fail(`unscripted ${c.functionName}`);
      }
    });
}
