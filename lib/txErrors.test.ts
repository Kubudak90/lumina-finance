import { describe, expect, it } from "vitest";
import {
  ExecutionRevertedError,
  InternalRpcError,
  InvalidInputRpcError,
  NonceMaxValueError,
  NonceTooHighError,
  NonceTooLowError,
  RawContractError,
  RpcRequestError,
  UserRejectedRequestError,
  encodeErrorResult,
  getContractError,
  type Abi,
  type BaseError,
  type Hex,
} from "viem";
import { getCallError, getTransactionError } from "viem/utils";
import aaveErrors from "../test/fixtures/aave-errors.json";
import pairErrors from "../test/fixtures/pair-errors.json";
import reverts from "../test/fixtures/revert-data.json";
import { ISOLATED_PAIR_ABI, POOL_ABI } from "./abis";
import { AAVE_ERRORS, EXCEEDS_BALANCE_MESSAGE, NONCE_MESSAGE, decodeRevert, describeTxError, type TxErrorContext } from "./txErrors";

const ERROR_STRING_ABI = [{ type: "error", name: "Error", inputs: [{ name: "message", type: "string" }] }] as const;
const POOL = "0x0000000000000000000000000000000000000100";
const PAIR = "0x0000000000000000000000000000000000000200";
const PAIR_FUNCTIONS_ONLY = ISOLATED_PAIR_ABI.filter((x) => x.type === "function") as unknown as Abi;

/** The error viem's simulateContract throws for revert bytes `data` (ContractFunctionExecutionError). */
function viemRevert(data: Hex, venue: "core" | "isolated", functionName: string, abi?: Abi) {
  return getContractError(new RawContractError({ data }), {
    abi: abi ?? ((venue === "core" ? POOL_ABI : ISOLATED_PAIR_ABI) as unknown as Abi),
    address: venue === "core" ? POOL : PAIR,
    functionName,
    args: [],
  });
}

const aaveRevert = (code: string, functionName = "borrow") =>
  viemRevert(encodeErrorResult({ abi: ERROR_STRING_ABI, errorName: "Error", args: [code] }), "core", functionName);

function captured(name: string) {
  const c = reverts.cases.find((x) => x.name === name);
  if (!c) throw new Error(`fixture ${name} missing`);
  return { ...c, error: viemRevert(c.data as Hex, c.venue as "core" | "isolated", c.functionName) };
}

const ctx = (over: Partial<TxErrorContext> = {}): TxErrorContext => ({ venue: "core", action: "borrow", ...over });

describe("Aave error table = lumina-core Errors.sol", () => {
  it("has every code of the Errors.sol extraction, by the same constant name, and nothing else", () => {
    expect(aaveErrors.commit).toBe("ea6465c0ff03789e4b0a66cf117f8cb8b40bf93e");
    for (const e of aaveErrors.errors) expect(AAVE_ERRORS[e.code]?.name, e.code).toBe(e.name);
    expect(Object.keys(AAVE_ERRORS).sort()).toEqual(aaveErrors.errors.map((e) => e.code).sort());
  });

  it("59 is PRICE_ORACLE_SENTINEL_CHECK_FAILED, not an eMode error (the old table was off by one)", () => {
    expect(AAVE_ERRORS["59"].name).toBe("PRICE_ORACLE_SENTINEL_CHECK_FAILED");
    expect(describeTxError(aaveRevert("59"), ctx({ action: "supply" }))).not.toMatch(/emode/i);
  });

  const MEANINGS: Record<string, [string, RegExp]> = {
    "26": ["INVALID_AMOUNT", /amount must be greater than 0/i],
    "29": ["RESERVE_PAUSED", /reserve is paused/i],
    "30": ["BORROWING_NOT_ENABLED", /borrowing is not enabled/i],
    "32": ["NOT_ENOUGH_AVAILABLE_USER_BALANCE", /cannot withdraw more than your available balance/i],
    "35": ["HEALTH_FACTOR_LOWER_THAN_LIQUIDATION_THRESHOLD", /health factor would be below the liquidation threshold/i],
    "36": ["COLLATERAL_CANNOT_COVER_NEW_BORROW", /not enough collateral to cover this borrow/i],
    "50": ["BORROW_CAP_EXCEEDED", /borrow cap is exceeded/i],
    "59": ["PRICE_ORACLE_SENTINEL_CHECK_FAILED", /price oracle sentinel/i],
    "97": ["LIQUIDATION_GRACE_SENTINEL_CHECK_FAILED", /grace period/i],
  };

  for (const [code, [name, meaning]] of Object.entries(MEANINGS)) {
    it(`code ${code} decodes to ${name}`, () => {
      const d = decodeRevert(aaveRevert(code), "core");
      expect(d).toMatchObject({ kind: "aave", code, name });
      expect(aaveErrors.errors.find((e) => e.code === code)?.name).toBe(name);
      // A context without a special message shows the Errors.sol meaning and the code.
      const text = describeTxError(aaveRevert(code), ctx({ action: "approve" }));
      expect(text).toMatch(meaning);
      expect(text).toContain(`error ${code}`);
    });
  }

  it("real Pool reverts from the harness chain decode to their codes (26, 32, 36, 50, 59)", () => {
    const real: Record<string, string> = {
      "core supply 0 → 26": "26",
      "core withdraw over balance → 32": "32",
      "core borrow over collateral → 36": "36",
      "core borrow over cap → 50": "50",
      "core borrow, guard stale → 59": "59",
    };
    for (const [name, code] of Object.entries(real)) {
      const c = captured(name);
      expect(decodeRevert(c.error, "core"), name).toMatchObject({ kind: "aave", code, name: AAVE_ERRORS[code].name });
    }
  });

  it("numeric reasons are Aave codes only on the core venue", () => {
    expect(decodeRevert(aaveRevert("59"), "isolated")).toEqual({ kind: "reason", reason: "59" });
    expect(describeTxError(aaveRevert("59"), ctx({ venue: "isolated" }))).toBe("Contract error: 59");
  });
});

describe("viem error shapes and message forms", () => {
  const stale = () => captured("core borrow, guard stale → 59");

  it("the cause chain: ContractFunctionExecutionError → ContractFunctionRevertedError (reason '59')", () => {
    const err = stale().error;
    expect(err.name).toBe("ContractFunctionExecutionError");
    expect(decodeRevert(err, "core")).toMatchObject({ kind: "aave", code: "59" });
  });

  it("the 'reason:\\n59' message form, from the real viem message (no structured fields)", () => {
    const c = stale();
    expect(c.viemShortMessage).toContain("reverted with the following reason:\n59");
    expect(decodeRevert(new Error(c.viemMessage!), "core")).toMatchObject({ kind: "aave", code: "59" });
    expect(decodeRevert(new Error(c.viemShortMessage!), "core")).toMatchObject({ kind: "aave", code: "59" });
    // Wrapped one level deeper, as wagmi does.
    expect(decodeRevert(new Error("Simulation failed", { cause: new Error(c.viemMessage!) }), "core")).toMatchObject({ code: "59" });
  });

  it("the node's 'execution reverted: …' forms", () => {
    expect(decodeRevert(new Error(stale().rpcMessage), "core")).toMatchObject({ kind: "aave", code: "59" });
    const insolvent = captured("pair borrowAsset over max LTV → Insolvent");
    expect(decodeRevert(new Error(insolvent.rpcMessage), "isolated")).toMatchObject({ kind: "custom", name: "Insolvent" });
    expect(decodeRevert(new Error("reverted with reason string '36'"), "core")).toMatchObject({ kind: "aave", code: "36" });
  });

  it("a wallet rejection is not a revert", () => {
    const err = new UserRejectedRequestError(new Error("User rejected the request."));
    expect(describeTxError(err, ctx())).toBe("Transaction rejected by user");
  });
});

describe("pair custom errors (ISOLATED_PAIR_ABI error entries)", () => {
  it("every error of LightlendPairConstants.sol + LightlendPairAccessControlErrors.sol decodes by name", () => {
    expect(pairErrors.errors).toHaveLength(30);
    for (const e of pairErrors.errors) {
      const item = ISOLATED_PAIR_ABI.find((x) => x.type === "error" && x.name === e.name);
      expect(item, e.name).toBeDefined();
      const args = (item as { inputs: readonly { type: string }[] }).inputs.map((i) => (i.type === "address" ? PAIR : 1n));
      const data = encodeErrorResult({ abi: ISOLATED_PAIR_ABI as unknown as Abi, errorName: e.name, args });
      expect(data.slice(0, 10), e.name).toBe(e.selector);
      expect(decodeRevert(viemRevert(data, "isolated", "borrowAsset"), "isolated"), e.name).toMatchObject({ kind: "custom", name: e.name });
    }
  });

  it("Insolvent decodes from real borrowAsset revert data (over max LTV), with its arguments", () => {
    const c = captured("pair borrowAsset over max LTV → Insolvent");
    const d = decodeRevert(c.error, "isolated");
    expect(d).toMatchObject({ kind: "custom", name: "Insolvent" });
    const [borrow, collateral, rate] = (d as { args: readonly bigint[] }).args;
    expect(collateral).toBe(3n * 10n ** 18n);
    expect(borrow > 20_000n * 10n ** 6n).toBe(true);
    expect(rate > 0n).toBe(true);
  });

  it("ExceedsMaxOracleDeviation decodes from real reverts with the guard stale (borrowAsset, removeCollateral)", () => {
    for (const name of [
      "pair borrowAsset, guard stale → ExceedsMaxOracleDeviation",
      "pair removeCollateral with debt, guard stale → ExceedsMaxOracleDeviation",
    ]) {
      const c = captured(name);
      expect(c.guardStatus).toBe("REFERENCE_STALE");
      expect(decodeRevert(c.error, "isolated"), name).toMatchObject({ kind: "custom", name: "ExceedsMaxOracleDeviation" });
    }
  });

  it("raw bytes decode even when the call's ABI lacked the error entries", () => {
    const c = reverts.cases.find((x) => x.name.startsWith("pair borrowAsset over max LTV"))!;
    const err = viemRevert(c.data as Hex, "isolated", "borrowAsset", PAIR_FUNCTIONS_ONLY);
    expect(decodeRevert(err, "isolated")).toMatchObject({ kind: "custom", name: "Insolvent" });
  });

  it("other real pair reverts: BorrowerSolvent, PastDeadline, InsufficientAssetsInContract, Panic 0x11", () => {
    const iso = (action: TxErrorContext["action"]) => ctx({ venue: "isolated", action });
    expect(describeTxError(captured("pair liquidate solvent borrower → BorrowerSolvent").error, iso("liquidate"))).toMatch(/borrower is solvent/);
    expect(describeTxError(captured("pair liquidate past deadline → PastDeadline").error, iso("liquidate"))).toMatch(/deadline passed/);
    expect(describeTxError(captured("pair borrowAsset over liquidity → InsufficientAssetsInContract").error, iso("borrow"))).toMatch(
      /Not enough liquidity in the pair/,
    );
    const panic = captured("pair removeCollateral over balance → Panic 0x11").error;
    expect(decodeRevert(panic, "isolated")).toEqual({ kind: "panic", code: 0x11n });
    expect(describeTxError(panic, iso("removeCollateral"))).toBe("The amount is more than your position holds.");
  });

  it("decodes F3's NothingToRepay custom error on the isolated venue", () => {
    const data = encodeErrorResult({ abi: ISOLATED_PAIR_ABI as unknown as Abi, errorName: "NothingToRepay", args: [] });
    const err = viemRevert(data, "isolated", "repayAsset");
    expect(decodeRevert(err, "isolated")).toEqual({ kind: "custom", name: "NothingToRepay", args: [] });
    expect(describeTxError(err, ctx({ venue: "isolated", action: "repay" }))).toBe("Nothing left to repay.");
  });

  it("decodes F2's InsufficientGasForGuard custom error from the dual oracle on the isolated venue", () => {
    const data = encodeErrorResult({
      abi: [{ name: "InsufficientGasForGuard", type: "error", inputs: [] }] as const,
      errorName: "InsufficientGasForGuard",
      args: [],
    });
    expect(ISOLATED_PAIR_ABI.find((x) => x.type === "error" && x.name === "InsufficientGasForGuard")).toBeDefined();
    const err = viemRevert(data, "isolated", "liquidate");
    expect(decodeRevert(err, "isolated")).toEqual({ kind: "custom", name: "InsufficientGasForGuard", args: [] });
    expect(decodeRevert(viemRevert(data, "isolated", "liquidate", PAIR_FUNCTIONS_ONLY), "isolated")).toEqual({
      kind: "custom",
      name: "InsufficientGasForGuard",
      args: [],
    });
    expect(describeTxError(err, ctx({ venue: "isolated", action: "liquidate" }))).toMatch(/higher gas limit/i);
  });
});

describe("context-dependent messages (action × guard status)", () => {
  const core59 = () => captured("core borrow, guard stale → 59").error;
  const borrowDev = () => captured("pair borrowAsset, guard stale → ExceedsMaxOracleDeviation").error;
  const removeDev = () => captured("pair removeCollateral with debt, guard stale → ExceedsMaxOracleDeviation").error;

  it("a borrow blocked by a stale reference (59 or ExceedsMaxOracleDeviation): the spec text, never 'EMode'", () => {
    const expected = "Borrowing is paused until a fresh price is posted; repaying and adding collateral still work.";
    expect(describeTxError(core59(), ctx({ guardStatus: "REFERENCE_STALE" }))).toBe(expected);
    expect(describeTxError(borrowDev(), ctx({ venue: "isolated", guardStatus: "REFERENCE_STALE" }))).toBe(expected);
  });

  it("REFERENCE_STALE, PAUSED and DEVIATION each get their own text", () => {
    const texts = (["REFERENCE_STALE", "PAUSED", "DEVIATION"] as const).map((guardStatus) => describeTxError(core59(), ctx({ guardStatus })));
    expect(new Set(texts).size).toBe(3);
    expect(texts[1]).toMatch(/paused by the guardian/);
    expect(texts[2]).toMatch(/disagree/);
    const removeTexts = (["REFERENCE_STALE", "PAUSED", "DEVIATION"] as const).map((guardStatus) =>
      describeTxError(removeDev(), ctx({ venue: "isolated", action: "removeCollateral", guardStatus })),
    );
    expect(new Set(removeTexts).size).toBe(3);
  });

  it("borrow, remove-collateral and liquidate differ for the same revert", () => {
    const borrow = describeTxError(borrowDev(), ctx({ venue: "isolated", guardStatus: "REFERENCE_STALE" }));
    const remove = describeTxError(removeDev(), ctx({ venue: "isolated", action: "removeCollateral", guardStatus: "REFERENCE_STALE" }));
    expect(remove).toMatch(/^Removing collateral is paused while the price check fails/);
    expect(remove).not.toBe(borrow);
    const liquidate = describeTxError(core59(), ctx({ action: "liquidate", guardStatus: "REFERENCE_STALE" }));
    expect(liquidate).toMatch(/health factor below 0\.95/);
    expect(liquidate).not.toBe(describeTxError(core59(), ctx({ guardStatus: "REFERENCE_STALE" })));
  });

  it("guard OK (or unknown) but the pair oracle fails: the pair-level reason", () => {
    expect(describeTxError(borrowDev(), ctx({ venue: "isolated", guardStatus: "OK" }))).toMatch(/this pair's price check fails/);
    expect(describeTxError(removeDev(), ctx({ venue: "isolated", action: "removeCollateral" }))).toMatch(/pair oracle/);
  });

  it("Insolvent reads differently for a borrow and a collateral removal", () => {
    const err = captured("pair borrowAsset over max LTV → Insolvent").error;
    const borrow = describeTxError(err, ctx({ venue: "isolated" }));
    const remove = describeTxError(err, ctx({ venue: "isolated", action: "removeCollateral" }));
    expect(borrow).toMatch(/This borrow would put the position above the pair's max LTV/);
    expect(remove).toMatch(/Removing this much collateral/);
  });
});

describe("one text parser for every textual form (Gemini r1 #1)", () => {
  const STALE_BORROW = "Borrowing is paused until a fresh price is posted; repaying and adding collateral still work.";
  const stale = (over: Partial<TxErrorContext> = {}) => ctx({ guardStatus: "REFERENCE_STALE", ...over });

  it("a structured reason 'execution reverted: 59' → the guard-stale borrow message", () => {
    const err = { name: "ContractFunctionRevertedError", reason: "execution reverted: 59" };
    expect(decodeRevert(err, "core")).toMatchObject({ kind: "aave", code: "59" });
    expect(describeTxError(err, stale())).toBe(STALE_BORROW);
    expect(describeTxError(new Error("Simulation failed", { cause: err }), stale())).toBe(STALE_BORROW);
  });

  it("the viem reason capture with an 'execution reverted:' prefix", () => {
    const err = new Error('The contract function "borrow" reverted with the following reason:\nexecution reverted: 59');
    expect(describeTxError(err, stale())).toBe(STALE_BORROW);
  });

  it("'execution reverted: custom error 0x…' with no data → the pair message", () => {
    const err = { reason: "execution reverted: custom error 0x345513d9" };
    expect(decodeRevert(err, "isolated")).toMatchObject({ kind: "custom", name: "ExceedsMaxOracleDeviation" });
    expect(describeTxError(err, stale({ venue: "isolated" }))).toBe(STALE_BORROW);
    expect(describeTxError(err, stale({ venue: "isolated", action: "removeCollateral" }))).toMatch(/^Removing collateral is paused/);
    // A selector with arguments, as a structured reason.
    const insolvent = { reason: "execution reverted: custom error 0xed27783c" };
    expect(describeTxError(insolvent, ctx({ venue: "isolated" }))).toMatch(/This borrow would put the position above the pair's max LTV/);
  });

  it("'panic: … (0x11)' and 'reverted with reason string' forms, prefixed or not", () => {
    expect(decodeRevert({ reason: "execution reverted: panic: arithmetic underflow or overflow (0x11)" }, "isolated")).toEqual({ kind: "panic", code: 0x11n });
    expect(decodeRevert(new Error("execution reverted: panic: arithmetic underflow or overflow (0x11)"), "isolated")).toEqual({ kind: "panic", code: 0x11n });
    expect(decodeRevert({ reason: "execution reverted: reverted with reason string '36'" }, "core")).toMatchObject({ kind: "aave", code: "36" });
    expect(decodeRevert(new Error("call failed: reverted with reason string '59'"), "core")).toMatchObject({ kind: "aave", code: "59" });
  });

  it("a bare 'execution reverted' is not a decoded revert (short raw text kept)", () => {
    expect(decodeRevert({ reason: "execution reverted" }, "core")).toBeNull();
    expect(describeTxError(new Error("execution reverted"), ctx())).toBe("execution reverted");
  });
});

describe("a bare 4-byte selector names a parameterized pair error (Gemini r1 #2)", () => {
  it("0xed27783c → Insolvent and 0xc5bb6dae → InsufficientAssetsInContract, with no arguments", () => {
    const insolvent = viemRevert("0xed27783c", "isolated", "borrowAsset");
    expect(decodeRevert(insolvent, "isolated")).toEqual({ kind: "custom", name: "Insolvent", args: [] });
    expect(describeTxError(insolvent, ctx({ venue: "isolated" }))).toMatch(/This borrow would put the position above the pair's max LTV/);
    const liquidity = new Error('The contract function "borrowAsset" reverted with the following signature:\n0xc5bb6dae');
    expect(decodeRevert(liquidity, "isolated")).toEqual({ kind: "custom", name: "InsufficientAssetsInContract", args: [] });
    expect(describeTxError(liquidity, ctx({ venue: "isolated" }))).toBe("Not enough liquidity in the pair to borrow this amount.");
  });

  it("every pair error's bare selector resolves to its name; on the core venue it stays unknown", () => {
    for (const e of pairErrors.errors) {
      expect(decodeRevert(viemRevert(e.selector as Hex, "isolated", "borrowAsset"), "isolated"), e.name).toMatchObject({ kind: "custom", name: e.name });
    }
    expect(decodeRevert(viemRevert("0xed27783c", "core", "borrow"), "core")).toEqual({ kind: "unknown", data: "0xed27783c" });
  });
});

describe("nested EIP-1193 payloads (Gemini r1 #3)", () => {
  const data59 = () => reverts.cases.find((c) => c.name === "core borrow, guard stale → 59")!.data;
  const STALE_BORROW = "Borrowing is paused until a fresh price is posted; repaying and adding collateral still work.";

  it("InternalRpcError-shaped: data: { message: 'execution reverted: 59', data: 0x08c379a0… }", () => {
    const rpcError = { name: "InternalRpcError", code: -32603, message: "Internal JSON-RPC error.", data: { code: 3, message: "execution reverted: 59", data: data59() } };
    expect(data59().startsWith("0x08c379a0")).toBe(true);
    expect(decodeRevert(rpcError, "core")).toMatchObject({ kind: "aave", code: "59" });
    expect(describeTxError(rpcError, ctx({ guardStatus: "REFERENCE_STALE" }))).toBe(STALE_BORROW);
    // The payload's message alone is enough.
    const messageOnly = { ...rpcError, data: { code: 3, message: "execution reverted: 59" } };
    expect(decodeRevert(messageOnly, "core")).toMatchObject({ kind: "aave", code: "59" });
    // As the cause of viem's InternalRpcError.
    const wrapped = new InternalRpcError(Object.assign(new Error("Internal JSON-RPC error."), { data: rpcError.data }));
    expect(describeTxError(wrapped, ctx({ guardStatus: "REFERENCE_STALE" }))).toBe(STALE_BORROW);
  });

  it("data: { data: 0x345513d9 } and MetaMask's data.originalError.data", () => {
    const flat = { name: "InternalRpcError", code: -32603, message: "Internal JSON-RPC error.", data: { data: "0x345513d9" } };
    expect(decodeRevert(flat, "isolated")).toEqual({ kind: "custom", name: "ExceedsMaxOracleDeviation", args: [] });
    const original = { code: -32603, message: "Internal JSON-RPC error.", data: { originalError: { code: 3, data: "0x345513d9", message: "execution reverted" } } };
    expect(decodeRevert(original, "isolated")).toEqual({ kind: "custom", name: "ExceedsMaxOracleDeviation", args: [] });
    const originalMessage = { code: -32603, message: "Internal JSON-RPC error.", data: { originalError: { message: "execution reverted: custom error 0x75e595fa" } } };
    expect(decodeRevert(originalMessage, "isolated")).toMatchObject({ kind: "custom", name: "BorrowerSolvent" });
  });
});

describe("viem's real wrapping of node and wallet errors (Gemini r2)", () => {
  const STALE_BORROW = "Borrowing is paused until a fresh price is posted; repaying and adding collateral still work.";
  const data59 = () => reverts.cases.find((c) => c.name === "core borrow, guard stale → 59")!.data as Hex;

  /** writeContract: provider error → sendTransaction's getTransactionError → getContractError. */
  const viaSend = (rpcError: BaseError, venue: "core" | "isolated") =>
    getContractError(getTransactionError(rpcError, { account: null } as never), {
      abi: (venue === "core" ? POOL_ABI : ISOLATED_PAIR_ABI) as unknown as Abi,
      address: venue === "core" ? POOL : PAIR,
      functionName: venue === "core" ? "borrow" : "borrowAsset",
      args: [],
    });
  /** simulateContract: provider error → call's getCallError → getContractError. */
  const viaCall = (rpcError: BaseError, venue: "core" | "isolated") =>
    getContractError(getCallError(rpcError, {} as never), {
      abi: (venue === "core" ? POOL_ABI : ISOLATED_PAIR_ABI) as unknown as Abi,
      address: venue === "core" ? POOL : PAIR,
      functionName: venue === "core" ? "borrow" : "borrowAsset",
      args: [],
    });
  /** An HTTP RPC answering { code: -32000, message } (no data), as buildRequest wraps it. */
  const nodeError = (message: string) =>
    new InvalidInputRpcError(new RpcRequestError({ body: { method: "eth_call" }, error: { code: -32000, message }, url: "http://rpc.invalid" }));
  /** MetaMask's EIP-1193 error, as buildRequest wraps it. */
  const metaMask = (data: object) =>
    new InternalRpcError(Object.assign(new Error("Internal JSON-RPC error."), { code: -32603, data }));

  it("-32000 'execution reverted: 59' with no data (ExecutionRevertedError chain) → the guard message, send and call paths", () => {
    for (const wrap of [viaSend, viaCall]) {
      const err = wrap(nodeError("execution reverted: 59"), "core");
      expect(err.shortMessage).toBe("Execution reverted with reason: 59.");
      expect(decodeRevert(err, "core")).toMatchObject({ kind: "aave", code: "59" });
      expect(describeTxError(err, ctx({ guardStatus: "REFERENCE_STALE" }))).toBe(STALE_BORROW);
    }
  });

  it("-32000 'execution reverted: custom error 0x345513d9' → the pair message", () => {
    const err = viaSend(nodeError("execution reverted: custom error 0x345513d9"), "isolated");
    expect(decodeRevert(err, "isolated")).toEqual({ kind: "custom", name: "ExceedsMaxOracleDeviation", args: [] });
    expect(describeTxError(err, ctx({ venue: "isolated", guardStatus: "REFERENCE_STALE" }))).toBe(STALE_BORROW);
  });

  it("a plain string reason through the same chain keeps its text", () => {
    const err = viaSend(nodeError("execution reverted: low exchange rate is 0"), "isolated");
    expect(describeTxError(err, ctx({ venue: "isolated" }))).toBe("Contract error: low exchange rate is 0");
  });

  it("bare 'execution reverted' / 'execution reverted.' keep the raw text, never 'Contract error: …'", () => {
    const unknownReason = new ExecutionRevertedError({ message: "execution reverted" });
    expect(decodeRevert(unknownReason, "core")).toBeNull();
    expect(describeTxError(unknownReason, ctx())).toBe("Execution reverted for an unknown reason.");
    expect(decodeRevert(new Error("execution reverted."), "core")).toBeNull();
    expect(describeTxError(new Error("execution reverted."), ctx())).toBe("execution reverted.");
    for (const message of ["execution reverted", "execution reverted."]) {
      for (const wrap of [viaSend, viaCall]) {
        const err = wrap(nodeError(message), "core");
        expect(decodeRevert(err, "core"), message).toBeNull();
        const text = describeTxError(err, ctx());
        expect(text, message).not.toMatch(/^Contract error/);
        expect(text, message).toBe(err.shortMessage);
      }
    }
  });

  it("MetaMask data.originalError.data bytes, through InternalRpcError and getContractError", () => {
    const err = viaSend(metaMask({ originalError: { code: 3, data: "0x345513d9", message: "execution reverted" } }), "isolated");
    // viem's own ContractFunctionRevertedError carries the wallet's generic text as its reason.
    expect(err.shortMessage).toContain("Internal JSON-RPC error.");
    expect(decodeRevert(err, "isolated")).toEqual({ kind: "custom", name: "ExceedsMaxOracleDeviation", args: [] });
    expect(describeTxError(err, ctx({ venue: "isolated", guardStatus: "REFERENCE_STALE" }))).toBe(STALE_BORROW);
    const withBytes = viaSend(metaMask({ code: 3, message: "execution reverted: 59", data: data59() }), "core");
    expect(describeTxError(withBytes, ctx({ guardStatus: "REFERENCE_STALE" }))).toBe(STALE_BORROW);
  });

  it("MetaMask message-only payloads (data.message, data.originalError.message)", () => {
    const err = viaSend(metaMask({ code: 3, message: "execution reverted: 59" }), "core");
    expect(decodeRevert(err, "core")).toMatchObject({ kind: "aave", code: "59" });
    expect(describeTxError(err, ctx({ guardStatus: "REFERENCE_STALE" }))).toBe(STALE_BORROW);
    const original = viaSend(metaMask({ originalError: { code: 3, message: "execution reverted: custom error 0x75e595fa" } }), "isolated");
    expect(describeTxError(original, ctx({ venue: "isolated", action: "liquidate" }))).toMatch(/borrower is solvent/);
  });

  it("a wallet error with no revert detail keeps the wallet's text as the last resort", () => {
    const err = viaSend(metaMask({}), "core");
    expect(describeTxError(err, ctx())).toBe("Contract error: Internal JSON-RPC error.");
  });

  it("a stale nonce (node 'nonce too low' / 'nonce too high', as viem wraps it) → reset the wallet activity (U4 r1 #5)", () => {
    for (const message of ["nonce too low", "nonce too high"]) {
      const err = viaSend(nodeError(message), "core");
      expect(describeTxError(err, ctx({ action: "supply" })), message).toBe(NONCE_MESSAGE);
    }
  });

  /** A real send: viem's TransactionExecutionError lists the request arguments, incl. the nonce. */
  const viaSendWithNonce = (rpcError: BaseError, venue: "core" | "isolated") =>
    getContractError(
      getTransactionError(rpcError, {
        account: { address: "0x000000000000000000000000000000000000A11c", type: "json-rpc" },
        nonce: 7,
        to: venue === "core" ? POOL : PAIR,
        data: "0x1234",
      } as never),
      {
        abi: (venue === "core" ? POOL_ABI : ISOLATED_PAIR_ABI) as unknown as Abi,
        address: venue === "core" ? POOL : PAIR,
        functionName: venue === "core" ? "borrow" : "borrowAsset",
        args: [],
      },
    );

  it("a revert whose request arguments list 'nonce: 7' still decodes: '59' → the guard message, Insolvent → its text (U4 r2 #3)", () => {
    const guard = viaSendWithNonce(nodeError("execution reverted: 59"), "core");
    expect(guard.message).toMatch(/Request Arguments:[\s\S]*nonce:\s+7/);
    expect(describeTxError(guard, ctx({ guardStatus: "REFERENCE_STALE" }))).toBe(STALE_BORROW);

    const insolvent = viaSendWithNonce(nodeError("execution reverted: custom error 0xed27783c"), "isolated");
    expect(insolvent.message).toMatch(/nonce:\s+7/);
    expect(describeTxError(insolvent, ctx({ venue: "isolated" }))).toBe(
      "This borrow would put the position above the pair's max LTV; borrow less or add collateral.",
    );

    // Nothing decodable: the raw text, still not the nonce message.
    const bare = viaSendWithNonce(nodeError("execution reverted"), "core");
    expect(bare.message).toMatch(/nonce:\s+7/);
    expect(describeTxError(bare, ctx())).not.toBe(NONCE_MESSAGE);
  });

  it("a real stale nonce on the same send path (NonceTooLowError in the chain, args listing a nonce) → the nonce message", () => {
    const err = viaSendWithNonce(nodeError("nonce too low"), "core");
    expect(err.walk((e) => e instanceof NonceTooLowError)).toBeInstanceOf(NonceTooLowError);
    expect(describeTxError(err, ctx())).toBe(NONCE_MESSAGE);
  });
});

describe("restored wallet-level messages of the removed error map (U4 r1 #5)", () => {
  it("viem's NonceTooLowError / NonceTooHighError / NonceMaxValueError, bare or as a cause, by class or by name", () => {
    expect(describeTxError(new NonceTooLowError({ nonce: 3 }), ctx())).toBe(NONCE_MESSAGE);
    expect(describeTxError(new NonceTooHighError({ nonce: 9 }), ctx())).toBe(NONCE_MESSAGE);
    expect(describeTxError(new NonceMaxValueError({ nonce: 2 ** 64 }), ctx())).toBe(NONCE_MESSAGE);
    const wrapped = Object.assign(new Error("Transaction failed"), { cause: Object.assign(new Error("x"), { name: "NonceTooLowError" }) });
    expect(describeTxError(wrapped, ctx())).toBe(NONCE_MESSAGE);
    expect(NONCE_MESSAGE).toBe("Nonce error — try resetting your wallet activity");
  });

  it("any error text with the word 'nonce' (a wallet's own wording), but not a longer word", () => {
    expect(describeTxError(new Error("Nonce provided for the transaction is lower than the current nonce of the account."), ctx())).toBe(
      NONCE_MESSAGE,
    );
    expect(describeTxError(new Error("invalid nonces list"), ctx())).toBe("invalid nonces list");
  });

  it("'exceeds balance' (an ERC-20 transfer over the balance) → the old map's wording", () => {
    const erc20 = viemRevert(
      encodeErrorResult({ abi: ERROR_STRING_ABI, errorName: "Error", args: ["ERC20: transfer amount exceeds balance"] }),
      "core",
      "supply",
    );
    expect(describeTxError(erc20, ctx({ action: "supply" }))).toBe(EXCEEDS_BALANCE_MESSAGE);
    expect(describeTxError(new Error("execution reverted: ERC20: burn amount exceeds balance"), ctx())).toBe(EXCEEDS_BALANCE_MESSAGE);
    expect(EXCEEDS_BALANCE_MESSAGE).toBe("Amount exceeds your balance");
  });

  it("a user rejection still wins over every other wording in the chain", () => {
    const err = Object.assign(new Error("User rejected the request."), { cause: new Error("nonce too low") });
    expect(describeTxError(err, ctx())).toBe("Transaction rejected by user");
  });
});

describe("fallbacks", () => {
  it("an unknown selector keeps the raw text (with the selector)", () => {
    const err = viemRevert("0xdeadbeef", "isolated", "borrowAsset");
    expect(decodeRevert(err, "isolated")).toEqual({ kind: "unknown", data: "0xdeadbeef" });
    const text = describeTxError(err, ctx({ venue: "isolated" }));
    expect(text).toContain("0xdeadbeef");
    expect(text).toMatch(/borrowAsset/);
  });

  it("a pair custom error on the core venue is not mapped through the Aave table", () => {
    const c = reverts.cases.find((x) => x.name.startsWith("pair borrowAsset over max LTV"))!;
    expect(decodeRevert(viemRevert(c.data as Hex, "core", "borrow"), "core")).toMatchObject({ kind: "unknown" });
  });

  it("a non-revert error keeps its short text; nothing yields an empty string", () => {
    expect(describeTxError(new Error("network down"), ctx())).toBe("network down");
    expect(describeTxError(null, ctx())).toBe("Unknown error");
    expect(describeTxError({}, ctx())).toBe("Unknown error");
  });

  it("covers what the removed parseErrorMessage did for a wallet rejection and a missing error", () => {
    expect(describeTxError(new Error("User rejected the request."), { venue: "core", action: "borrow" })).toBe("Transaction rejected by user");
    expect(describeTxError(null as unknown as Error, { venue: "core", action: "borrow" })).toBe("Unknown error");
  });
});
