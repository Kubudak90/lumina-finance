/**
 * Transaction errors → user-facing text (ui-usability-v1 spec §3.2). Replaces `parseErrorMessage`
 * (lib/errorMessages.ts), which stays until its callers move over.
 *
 * - Walks viem's error cause chain: `ContractFunctionRevertedError` (`data.errorName`, `raw`,
 *   `reason`, `signature`), raw revert bytes on any level, then the message forms
 *   ("…reverted with the following reason:\n59", "execution reverted: 59", "custom error 0x…").
 * - Aave numeric reasons are read with the table below, rebuilt from lumina-core Errors.sol, and only
 *   for `venue === "core"`; pair reverts decode by name with the `error` entries of
 *   ISOLATED_PAIR_ABI.
 * - The text depends on the action and the price-guard status: the same '59' or
 *   `ExceedsMaxOracleDeviation` means something different for a borrow, a collateral removal or a
 *   liquidation, and for a stale reference, a guardian pause or a price deviation.
 * - Anything unrecognised keeps its short raw text.
 */
import { decodeErrorResult, type Abi, type Hex } from "viem";
import { ISOLATED_PAIR_ABI } from "./abis";
import type { GuardStatusKey } from "./guard";

export type TxVenue = "core" | "isolated";

export type TxAction =
  | "supply"
  | "withdraw"
  | "borrow"
  | "repay"
  | "collateral"
  | "liquidate"
  | "lend"
  | "addCollateral"
  | "removeCollateral"
  | "approve";

export interface TxErrorContext {
  venue: TxVenue;
  action: TxAction;
  /** LuminaPriceGuard.borrowStatus() at the time of the error, when known. */
  guardStatus?: GuardStatusKey | undefined;
}

// =============================================================================================
// Aave error codes
// =============================================================================================

/**
 * lumina-core src/contracts/protocol/libraries/helpers/Errors.sol at commit
 * ea6465c0ff03789e4b0a66cf117f8cb8b40bf93e (branch master; file blob d3f564cb, identical in the
 * deployed S5c-run2 tree). Code → constant name and a user-facing rendering of its comment.
 * test/fixtures/aave-errors.json holds the extraction this table is checked against.
 */
const AAVE_ERROR_ROWS: readonly (readonly [code: number, name: string, message: string])[] = [
  [1, "CALLER_NOT_POOL_ADMIN", "The caller is not a pool admin"],
  [2, "CALLER_NOT_EMERGENCY_ADMIN", "The caller is not an emergency admin"],
  [3, "CALLER_NOT_POOL_OR_EMERGENCY_ADMIN", "The caller is not a pool or emergency admin"],
  [4, "CALLER_NOT_RISK_OR_POOL_ADMIN", "The caller is not a risk or pool admin"],
  [5, "CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN", "The caller is not an asset listing or pool admin"],
  [6, "CALLER_NOT_BRIDGE", "The caller is not a bridge"],
  [7, "ADDRESSES_PROVIDER_NOT_REGISTERED", "The pool addresses provider is not registered"],
  [8, "INVALID_ADDRESSES_PROVIDER_ID", "Invalid id for the pool addresses provider"],
  [9, "NOT_CONTRACT", "The address is not a contract"],
  [10, "CALLER_NOT_POOL_CONFIGURATOR", "The caller is not the pool configurator"],
  [11, "CALLER_NOT_ATOKEN", "The caller is not an aToken"],
  [12, "INVALID_ADDRESSES_PROVIDER", "The pool addresses provider address is invalid"],
  [13, "INVALID_FLASHLOAN_EXECUTOR_RETURN", "Invalid return value of the flash loan executor"],
  [14, "RESERVE_ALREADY_ADDED", "The reserve has already been added"],
  [15, "NO_MORE_RESERVES_ALLOWED", "The maximum number of reserves has been reached"],
  [16, "EMODE_CATEGORY_RESERVED", "eMode category 0 is reserved"],
  [17, "INVALID_EMODE_CATEGORY_ASSIGNMENT", "Invalid eMode category assignment"],
  [18, "RESERVE_LIQUIDITY_NOT_ZERO", "The reserve liquidity must be 0"],
  [19, "FLASHLOAN_PREMIUM_INVALID", "Invalid flash loan premium"],
  [20, "INVALID_RESERVE_PARAMS", "Invalid risk parameters for the reserve"],
  [21, "INVALID_EMODE_CATEGORY_PARAMS", "Invalid risk parameters for the eMode category"],
  [22, "BRIDGE_PROTOCOL_FEE_INVALID", "Invalid bridge protocol fee"],
  [23, "CALLER_MUST_BE_POOL", "The caller must be the pool"],
  [24, "INVALID_MINT_AMOUNT", "Invalid amount to mint"],
  [25, "INVALID_BURN_AMOUNT", "Invalid amount to burn"],
  [26, "INVALID_AMOUNT", "The amount must be greater than 0"],
  [27, "RESERVE_INACTIVE", "The reserve is not active"],
  [28, "RESERVE_FROZEN", "The reserve is frozen"],
  [29, "RESERVE_PAUSED", "The reserve is paused"],
  [30, "BORROWING_NOT_ENABLED", "Borrowing is not enabled for this asset"],
  [32, "NOT_ENOUGH_AVAILABLE_USER_BALANCE", "You cannot withdraw more than your available balance"],
  [33, "INVALID_INTEREST_RATE_MODE_SELECTED", "Invalid interest rate mode"],
  [34, "COLLATERAL_BALANCE_IS_ZERO", "Your collateral balance is 0"],
  [35, "HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD", "The health factor would be below the liquidation threshold"],
  [36, "COLLATERAL_CANNOT_COVER_NEW_BORROW", "Not enough collateral to cover this borrow"],
  [37, "COLLATERAL_SAME_AS_BORROWING_CURRENCY", "The collateral is (mostly) the currency being borrowed"],
  [39, "NO_DEBT_OF_SELECTED_TYPE", "You have no debt of this type"],
  [40, "NO_EXPLICIT_AMOUNT_TO_REPAY_ON_BEHALF", "Repaying on behalf of another account needs an explicit amount"],
  [42, "NO_OUTSTANDING_VARIABLE_DEBT", "You have no variable-rate debt on this reserve"],
  [43, "UNDERLYING_BALANCE_ZERO", "Your supplied balance of this asset is 0"],
  [44, "INTEREST_RATE_REBALANCE_CONDITIONS_NOT_MET", "Interest rate rebalance conditions were not met"],
  [45, "HEALTH_FACTOR_NOT_BELOW_THRESHOLD", "The health factor is not below the liquidation threshold"],
  [46, "COLLATERAL_CANNOT_BE_LIQUIDATED", "The chosen collateral cannot be liquidated"],
  [47, "SPECIFIED_CURRENCY_NOT_BORROWED_BY_USER", "The account did not borrow this asset"],
  [49, "INCONSISTENT_FLASHLOAN_PARAMS", "Inconsistent flash loan parameters"],
  [50, "BORROW_CAP_EXCEEDED", "The borrow cap is exceeded"],
  [51, "SUPPLY_CAP_EXCEEDED", "The supply cap is exceeded"],
  [52, "UNBACKED_MINT_CAP_EXCEEDED", "The unbacked mint cap is exceeded"],
  [53, "DEBT_CEILING_EXCEEDED", "The debt ceiling is exceeded"],
  [54, "UNDERLYING_CLAIMABLE_RIGHTS_NOT_ZERO", "Claimable rights over the underlying are not zero"],
  [56, "VARIABLE_DEBT_SUPPLY_NOT_ZERO", "The variable debt supply is not zero"],
  [57, "LTV_VALIDATION_FAILED", "LTV validation failed: your collateral has no borrowing power"],
  [58, "INCONSISTENT_EMODE_CATEGORY", "Inconsistent eMode category"],
  [59, "PRICE_ORACLE_SENTINEL_CHECK_FAILED", "The price oracle sentinel refused the action"],
  [60, "ASSET_NOT_BORROWABLE_IN_ISOLATION", "This asset is not borrowable in isolation mode"],
  [61, "RESERVE_ALREADY_INITIALIZED", "The reserve has already been initialized"],
  [62, "USER_IN_ISOLATION_MODE_OR_LTV_ZERO", "You are in isolation mode or the asset's LTV is 0"],
  [63, "INVALID_LTV", "Invalid LTV parameter for the reserve"],
  [64, "INVALID_LIQ_THRESHOLD", "Invalid liquidation threshold parameter for the reserve"],
  [65, "INVALID_LIQ_BONUS", "Invalid liquidation bonus parameter for the reserve"],
  [66, "INVALID_DECIMALS", "Invalid decimals parameter for the reserve's asset"],
  [67, "INVALID_RESERVE_FACTOR", "Invalid reserve factor parameter for the reserve"],
  [68, "INVALID_BORROW_CAP", "Invalid borrow cap for the reserve"],
  [69, "INVALID_SUPPLY_CAP", "Invalid supply cap for the reserve"],
  [70, "INVALID_LIQUIDATION_PROTOCOL_FEE", "Invalid liquidation protocol fee for the reserve"],
  [71, "INVALID_EMODE_CATEGORY", "Invalid eMode category for the reserve"],
  [72, "INVALID_UNBACKED_MINT_CAP", "Invalid unbacked mint cap for the reserve"],
  [73, "INVALID_DEBT_CEILING", "Invalid debt ceiling for the reserve"],
  [74, "INVALID_RESERVE_INDEX", "Invalid reserve index"],
  [75, "ACL_ADMIN_CANNOT_BE_ZERO", "The ACL admin cannot be the zero address"],
  [76, "INCONSISTENT_PARAMS_LENGTH", "Array parameters that should be equal length are not"],
  [77, "ZERO_ADDRESS_NOT_VALID", "The zero address is not valid"],
  [78, "INVALID_EXPIRATION", "Invalid expiration"],
  [79, "INVALID_SIGNATURE", "Invalid signature"],
  [80, "OPERATION_NOT_SUPPORTED", "Operation not supported"],
  [81, "DEBT_CEILING_NOT_ZERO", "The debt ceiling is not zero"],
  [82, "ASSET_NOT_LISTED", "The asset is not listed"],
  [83, "INVALID_OPTIMAL_USAGE_RATIO", "Invalid optimal usage ratio"],
  [85, "UNDERLYING_CANNOT_BE_RESCUED", "The underlying asset cannot be rescued"],
  [86, "ADDRESSES_PROVIDER_ALREADY_ADDED", "The pool addresses provider has already been added"],
  [87, "POOL_ADDRESSES_DO_NOT_MATCH", "The token's pool address does not match the initializing pool"],
  [89, "SILOED_BORROWING_VIOLATION", "A siloed asset cannot be borrowed together with other assets"],
  [90, "RESERVE_DEBT_NOT_ZERO", "The reserve's total debt must be 0"],
  [91, "FLASHLOAN_DISABLED", "Flash loans are disabled for this asset"],
  [92, "INVALID_MAX_RATE", "Invalid maximum borrow rate"],
  [93, "WITHDRAW_TO_ATOKEN", "Withdrawing to the aToken is not allowed"],
  [94, "SUPPLY_TO_ATOKEN", "Supplying to the aToken is not allowed"],
  [95, "SLOPE_2_MUST_BE_GTE_SLOPE_1", "Variable rate slope 2 cannot be lower than slope 1"],
  [96, "CALLER_NOT_RISK_OR_POOL_OR_EMERGENCY_ADMIN", "The caller is not a risk, pool or emergency admin"],
  [97, "LIQUIDATION_GRACE_SENTINEL_CHECK_FAILED", "Liquidations of this reserve are in a grace period"],
  [98, "INVALID_GRACE_PERIOD", "Grace period out of the valid range"],
  [99, "INVALID_FREEZE_STATE", "The reserve is already in that freeze state"],
  [100, "NOT_BORROWABLE_IN_EMODE", "This asset is not borrowable in your eMode category"],
];

export const AAVE_ERRORS: Readonly<Record<string, { name: string; message: string }>> = Object.fromEntries(
  AAVE_ERROR_ROWS.map(([code, name, message]) => [String(code), { name, message }]),
);

// =============================================================================================
// Decoding
// =============================================================================================

export type DecodedRevert =
  /** An Aave numeric reason (core venue only). */
  | { kind: "aave"; code: string; name: string; message: string }
  /** Error(string) that is not an Aave code (or any string reason on the isolated venue). */
  | { kind: "reason"; reason: string }
  /** A custom error decoded by name. */
  | { kind: "custom"; name: string; args: readonly unknown[] }
  | { kind: "panic"; code: bigint | undefined }
  /** Revert data no ABI here knows (an unknown selector). */
  | { kind: "unknown"; data: string };

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  cause?: unknown;
  data?: unknown;
  raw?: unknown;
  reason?: unknown;
  signature?: unknown;
  code?: unknown;
};

/** The error and its causes, outermost first (bounded, cycle-safe). */
function causeChain(err: unknown): ErrorLike[] {
  const out: ErrorLike[] = [];
  let e: unknown = err;
  while (e && typeof e === "object" && out.length < 20 && !out.includes(e as ErrorLike)) {
    out.push(e as ErrorLike);
    e = (e as ErrorLike).cause;
  }
  return out;
}

const isHex = (v: unknown): v is Hex => typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v);

function fromReason(reason: string, venue: TxVenue): DecodedRevert {
  const code = reason.trim();
  const entry = venue === "core" && /^\d{1,3}$/.test(code) ? AAVE_ERRORS[code] : undefined;
  return entry ? { kind: "aave", code, ...entry } : { kind: "reason", reason };
}

function fromDecoded(errorName: string, args: readonly unknown[] | undefined, venue: TxVenue): DecodedRevert {
  if (errorName === "Error") return fromReason(String(args?.[0] ?? ""), venue);
  if (errorName === "Panic") {
    const c = args?.[0];
    return { kind: "panic", code: typeof c === "bigint" ? c : typeof c === "number" ? BigInt(c) : undefined };
  }
  return { kind: "custom", name: errorName, args: args ?? [] };
}

/** Revert bytes → decoded: Error(string) and Panic always, pair errors on the isolated venue. */
function decodeData(data: Hex, venue: TxVenue): DecodedRevert | null {
  if (data.length < 10) return null;
  const abi = (venue === "isolated" ? ISOLATED_PAIR_ABI : []) as Abi;
  try {
    const d = decodeErrorResult({ abi, data });
    return fromDecoded(d.errorName, d.args as readonly unknown[] | undefined, venue);
  } catch {
    return { kind: "unknown", data };
  }
}

function fromStructured(e: ErrorLike, venue: TxVenue): DecodedRevert | null {
  const data = e.data as { errorName?: unknown; args?: unknown } | undefined;
  if (data && typeof data === "object" && typeof data.errorName === "string") {
    // Decoded by viem with the call's ABI; re-decode raw bytes for an ABI that may lack the entry.
    return fromDecoded(data.errorName, Array.isArray(data.args) ? data.args : undefined, venue);
  }
  if (isHex(e.raw)) {
    const d = decodeData(e.raw, venue);
    if (d) return d;
  }
  if (isHex(e.data)) {
    const d = decodeData(e.data, venue);
    if (d) return d;
  }
  if (typeof e.reason === "string" && e.reason && e.reason !== "execution reverted") return fromReason(e.reason, venue);
  if (isHex(e.signature)) return decodeData(e.signature, venue) ?? { kind: "unknown", data: e.signature };
  return null;
}

const MESSAGE_FORMS: readonly ((text: string, venue: TxVenue) => DecodedRevert | null)[] = [
  // viem: 'The contract function "borrow" reverted with the following reason:\n59'
  (t, v) => {
    const m = t.match(/reverted with the following reason:\s*\n?\s*([^\n]+)/);
    return m ? fromReason(m[1], v) : null;
  },
  // viem: '... reverted with the following signature:\n0x345513d9'
  (t, v) => {
    const m = t.match(/reverted with the following signature:\s*\n?\s*(0x[0-9a-fA-F]{8})/);
    return m ? (decodeData(m[1] as Hex, v) ?? { kind: "unknown", data: m[1] }) : null;
  },
  // Node / anvil: 'execution reverted: custom error 0xed27783c: 0000…'
  (t, v) => {
    const m = t.match(/custom error (0x[0-9a-fA-F]{8})(?::\s*([0-9a-fA-F]*))?/);
    return m ? decodeData(`${m[1]}${m[2] ?? ""}` as Hex, v) : null;
  },
  // 'reverted with reason string '59''
  (t, v) => {
    const m = t.match(/reverted with reason string\s*['"]([^'"]+)['"]/);
    return m ? fromReason(m[1], v) : null;
  },
  // 'execution reverted: 59'
  (t, v) => {
    const m = t.match(/execution reverted:\s*([^\n]+)/);
    return m ? fromReason(m[1], v) : null;
  },
];

/** The revert inside a wallet / viem error, or null when the error is not a contract revert. */
export function decodeRevert(err: unknown, venue: TxVenue): DecodedRevert | null {
  const chain = causeChain(err);
  for (const e of chain) {
    const d = fromStructured(e, venue);
    if (d) return d;
  }
  for (const e of chain) {
    for (const text of [e.shortMessage, e.message, e.details]) {
      if (typeof text !== "string" || !text) continue;
      for (const form of MESSAGE_FORMS) {
        const d = form(text, venue);
        if (d) return d;
      }
    }
  }
  return null;
}

// =============================================================================================
// Messages
// =============================================================================================

const STILL_WORKS = "repaying and adding collateral still work";

/** Why the guard blocks borrows, as a clause after "Borrowing is paused …". */
const GUARD_PAUSE: Partial<Record<GuardStatusKey, string>> = {
  REFERENCE_STALE: "until a fresh price is posted",
  PAUSED: "by the guardian",
  DEVIATION: "while the Lighter Core price and the keeper reference price disagree",
  NO_REFERENCE: "until the keeper posts its first reference price",
  CORE_PRICE_STALE: "while the Lighter Core price is stale",
  CORE_READ_FAILED: "while the Lighter Core price cannot be read",
  NO_MARKETS: "while the price guard has no markets configured",
};

/** Why the price check fails, as a parenthetical for a blocked collateral removal. */
const GUARD_CAUSE: Partial<Record<GuardStatusKey, string>> = {
  REFERENCE_STALE: "no fresh reference price has been posted",
  PAUSED: "the guardian paused borrowing",
  DEVIATION: "the Lighter Core and keeper reference prices disagree",
  NO_REFERENCE: "no reference price has been posted yet",
  CORE_PRICE_STALE: "the Lighter Core price is stale",
  CORE_READ_FAILED: "the Lighter Core price cannot be read",
  NO_MARKETS: "the price guard has no markets configured",
};

function borrowBlocked(ctx: TxErrorContext): string {
  const why = ctx.guardStatus ? GUARD_PAUSE[ctx.guardStatus] : undefined;
  if (why) return `Borrowing is paused ${why}; ${STILL_WORKS}.`;
  return ctx.venue === "core"
    ? `Borrowing is blocked by the price guard right now; ${STILL_WORKS}.`
    : `Borrowing is paused while this pair's price check fails (its oracle reports bad or diverging prices); ${STILL_WORKS}.`;
}

function removeBlocked(ctx: TxErrorContext): string {
  const why = (ctx.guardStatus ? GUARD_CAUSE[ctx.guardStatus] : undefined) ?? "the pair oracle reports bad or diverging prices";
  return `Removing collateral is paused while the price check fails (${why}); ${STILL_WORKS}.`;
}

const LIQUIDATION_SENTINEL =
  "Liquidation is not allowed right now: during the price sentinel's grace period only positions with a health factor below 0.95 can be liquidated.";

function describeAave(d: Extract<DecodedRevert, { kind: "aave" }>, ctx: TxErrorContext): string {
  if (d.code === "59" && ctx.action === "borrow") return borrowBlocked(ctx);
  if (d.code === "59" && ctx.action === "liquidate") return LIQUIDATION_SENTINEL;
  if (d.code === "97") return "Liquidation is not allowed yet: this reserve is in a liquidation grace period (error 97).";
  if (d.code === "26" && ctx.action === "borrow") {
    return "Invalid amount: it must be greater than 0 and within the reserve's available liquidity (error 26).";
  }
  return `${d.message} (error ${d.code}).`;
}

const PAIR_MESSAGES: Readonly<Record<string, string>> = {
  BorrowerSolvent: "This position cannot be liquidated: the borrower is solvent at the pair's current price.",
  ExceedsBorrowLimit: "This would exceed the pair's borrow limit.",
  ExceedsDepositLimit: "This would exceed the pair's deposit limit.",
  WithdrawPaused: "Withdrawals are paused on this pair.",
  RepayPaused: "Repayments are paused on this pair.",
  LiquidatePaused: "Liquidations are paused on this pair.",
  InterestPaused: "Interest is paused on this pair.",
  PastDeadline: "The liquidation deadline passed before the transaction was mined; try again.",
  InvalidReceiver: "The receiver address is invalid.",
  SlippageTooHigh: "The price moved beyond the allowed slippage.",
};

function describeCustom(d: Extract<DecodedRevert, { kind: "custom" }>, ctx: TxErrorContext): string {
  switch (d.name) {
    case "ExceedsMaxOracleDeviation":
      if (ctx.action === "borrow") return borrowBlocked(ctx);
      if (ctx.action === "removeCollateral") return removeBlocked(ctx);
      return "The pair's price check failed (its oracle reports bad or diverging prices).";
    case "Insolvent":
      if (ctx.action === "borrow") return "This borrow would put the position above the pair's max LTV; borrow less or add collateral.";
      if (ctx.action === "removeCollateral") return "Removing this much collateral would put the position above the pair's max LTV.";
      return "The position would be above the pair's max LTV.";
    case "InsufficientAssetsInContract":
      return ctx.action === "borrow"
        ? "Not enough liquidity in the pair to borrow this amount."
        : "Not enough idle liquidity in the pair for this amount right now.";
    default:
      return PAIR_MESSAGES[d.name] ?? `The contract rejected the transaction (${d.name}).`;
  }
}

function describePanic(d: Extract<DecodedRevert, { kind: "panic" }>, ctx: TxErrorContext): string {
  if (d.code === 0x11n) {
    return ctx.action === "removeCollateral" || ctx.action === "withdraw" || ctx.action === "repay"
      ? "The amount is more than your position holds."
      : "The contract rejected the amount (arithmetic overflow or underflow).";
  }
  return `The contract stopped with a panic (code 0x${(d.code ?? 0n).toString(16)}).`;
}

const MAX_RAW = 160;

/** The error's own short text (viem's shortMessage, else its first message line). */
function shortRaw(err: unknown): string {
  for (const e of causeChain(err)) {
    if (typeof e.shortMessage === "string" && e.shortMessage) return e.shortMessage.slice(0, MAX_RAW);
  }
  const message = causeChain(err).find((e) => typeof e.message === "string" && e.message)?.message as string | undefined;
  return message ? message.slice(0, MAX_RAW) : "Unknown error";
}

function walletMessage(err: unknown): string | null {
  for (const e of causeChain(err)) {
    const text = `${typeof e.message === "string" ? e.message : ""} ${typeof e.shortMessage === "string" ? e.shortMessage : ""}`;
    if (e.name === "UserRejectedRequestError" || e.code === 4001 || /user rejected|user denied|rejected the request/i.test(text)) {
      return "Transaction rejected by user";
    }
    if (/insufficient funds/i.test(text)) return "Insufficient funds for transaction";
  }
  return null;
}

/** One line for the user, from any error a send can produce. */
export function describeTxError(err: unknown, ctx: TxErrorContext): string {
  if (!err) return "Unknown error";
  const wallet = walletMessage(err);
  if (wallet) return wallet;
  const d = decodeRevert(err, ctx.venue);
  if (!d) return shortRaw(err);
  switch (d.kind) {
    case "aave":
      return describeAave(d, ctx);
    case "custom":
      return describeCustom(d, ctx);
    case "panic":
      return describePanic(d, ctx);
    case "reason":
      return `Contract error: ${d.reason.slice(0, 120)}`;
    case "unknown": {
      const raw = shortRaw(err);
      const selector = d.data.slice(0, 10);
      return raw.toLowerCase().includes(selector.toLowerCase()) ? raw : `${raw} (${selector})`;
    }
  }
}
