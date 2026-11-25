import { decodeEventLog, type Hex } from "viem";
import { ISOLATED_PAIR_ABI } from "./abis";

export interface ReceiptLogLike {
  address: `0x${string}`;
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
}

export interface RepayAssetEvent {
  payer: `0x${string}`;
  borrower: `0x${string}`;
  amountToRepay: bigint;
  shares: bigint;
}

/**
 * Extracts the pair's mined `RepayAsset(payer, borrower, amountToRepay, shares)` event from a
 * receipt's logs (F3). Ignores logs from other contracts or other events. Returns null when no
 * matching event is present.
 */
export function parseRepayAssetEvent(
  logs: readonly ReceiptLogLike[] | undefined,
  pair: `0x${string}`,
  borrower?: `0x${string}`,
): RepayAssetEvent | null {
  if (!logs || logs.length === 0) return null;
  const pairLc = pair.toLowerCase();
  const borrowerLc = borrower?.toLowerCase();
  for (const log of logs) {
    if (log.address.toLowerCase() !== pairLc) continue;
    if (log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: ISOLATED_PAIR_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "RepayAsset") continue;
      const args = decoded.args as unknown as RepayAssetEvent;
      if (borrowerLc && args.borrower.toLowerCase() !== borrowerLc) continue;
      return {
        payer: args.payer,
        borrower: args.borrower,
        amountToRepay: args.amountToRepay,
        shares: args.shares,
      };
    } catch {
      // Unrelated pair event (e.g. AddInterest, UpdateRate, Transfer); keep scanning.
    }
  }
  return null;
}
