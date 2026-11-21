import { describe, expect, it } from "vitest";
import { RawContractError, UserRejectedRequestError, encodeErrorResult, getContractError, type Abi, type Hex } from "viem";
import aaveErrors from "../test/fixtures/aave-errors.json";
import pairErrors from "../test/fixtures/pair-errors.json";
import reverts from "../test/fixtures/revert-data.json";
import { ISOLATED_PAIR_ABI, POOL_ABI } from "./abis";
import { parseErrorMessage } from "./errorMessages";
import { AAVE_ERRORS, decodeRevert, describeTxError, type TxErrorContext } from "./txErrors";

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

  it("parseErrorMessage is still exported and working until U2 moves its callers", () => {
    expect(parseErrorMessage(new Error("User rejected the request."))).toBe("Transaction rejected by user");
    expect(parseErrorMessage(null)).toBe("Unknown error");
  });
});
