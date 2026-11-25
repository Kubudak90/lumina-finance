import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { parseRepayAssetEvent, type ReceiptLogLike } from "./repayEvent";

const PAIR = "0x0000000000000000000000000000000000000200" as const;
const OTHER = "0x0000000000000000000000000000000000000999" as const;
const ALICE = "0x000000000000000000000000000000000000a11c" as const;
const BOB = "0x000000000000000000000000000000000000b0b0" as const;

const REPAY_ABI = parseAbi([
  "event RepayAsset(address indexed payer, address indexed borrower, uint256 amountToRepay, uint256 shares)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function repayLog(address: `0x${string}`, payer: `0x${string}`, borrower: `0x${string}`, amountToRepay: bigint, shares: bigint): ReceiptLogLike {
  const topics = encodeEventTopics({
    abi: REPAY_ABI,
    eventName: "RepayAsset",
    args: { payer, borrower },
  });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [amountToRepay, shares],
  );
  return { address, topics: topics as `0x${string}`[], data };
}

function transferLog(address: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint): ReceiptLogLike {
  const topics = encodeEventTopics({
    abi: REPAY_ABI,
    eventName: "Transfer",
    args: { from, to },
  });
  const data = encodeAbiParameters([{ type: "uint256" }], [value]);
  return { address, topics: topics as `0x${string}`[], data };
}

describe("parseRepayAssetEvent (F3)", () => {
  it("extracts amountToRepay and shares from the pair's mined RepayAsset log", () => {
    const logs: ReceiptLogLike[] = [
      transferLog(OTHER, ALICE, PAIR, 42_500_000n),
      repayLog(PAIR, ALICE, ALICE, 42_500_000n, 42_000_000n),
    ];
    expect(parseRepayAssetEvent(logs, PAIR, ALICE)).toEqual({
      payer: ALICE,
      borrower: ALICE,
      amountToRepay: 42_500_000n,
      shares: 42_000_000n,
    });
  });

  it("ignores RepayAsset logs from another contract or for another borrower", () => {
    const wrongPair = [repayLog(OTHER, ALICE, ALICE, 99_000_000n, 99n)];
    expect(parseRepayAssetEvent(wrongPair, PAIR, ALICE)).toBeNull();

    const wrongBorrower = [repayLog(PAIR, ALICE, BOB, 99_000_000n, 99n)];
    expect(parseRepayAssetEvent(wrongBorrower, PAIR, ALICE)).toBeNull();
  });

  it("returns null when logs are missing or contain no RepayAsset event", () => {
    expect(parseRepayAssetEvent(undefined, PAIR, ALICE)).toBeNull();
    expect(parseRepayAssetEvent([], PAIR, ALICE)).toBeNull();
    expect(parseRepayAssetEvent([transferLog(PAIR, ALICE, OTHER, 1n)], PAIR, ALICE)).toBeNull();
  });
});
