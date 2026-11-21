"use client";

import { coreRisk, isolatedRisk, type IsolatedMarketSides } from "@/lib/risk";
import { describeWrite, type TxPreview } from "@/lib/txPreview";
import type { WriteRequest } from "@/lib/chainPin";
import { AfterState, coreAfterRows, isolatedAfterRows } from "./TxSummary";
import { afterReadStatus, useCatchUp, type CoreRiskInputs, type IsolatedAccountRead } from "./reads";
import { formatToken } from "./format";

/** Declarative preview of a planned write (Details, before anything is sent). */
export function previewCall(request: WriteRequest): TxPreview {
  return describeWrite(request as Parameters<typeof describeWrite>[0]);
}

/**
 * Success screen, core: the user's HF, borrow limit used and liquidation price from the position
 * read once its block is at or after the receipt block.
 */
export function CoreAfterState({ core, receiptBlock }: { core: CoreRiskInputs; receiptBlock: bigint | undefined }) {
  const status = afterReadStatus({
    receiptBlock,
    stamp: core.positionStamp,
    failed: core.positionFailed,
    settled: core.positionSettled,
  });
  useCatchUp(status === "reading", core.refetchPosition);
  return <AfterState status={status} stamp={core.stamp} rows={coreAfterRows(coreRisk(core.snapshot))} />;
}

/** Success screen, isolated borrower: LTV, liquidation price, collateral and debt after the receipt. */
export function IsolatedAfterState({
  read,
  sides,
  receiptBlock,
  title,
}: {
  read: IsolatedAccountRead;
  sides: IsolatedMarketSides;
  receiptBlock: bigint | undefined;
  title?: string;
}) {
  const status = afterReadStatus({ receiptBlock, stamp: read.stamp, failed: read.failed, settled: read.settled });
  useCatchUp(status === "reading", read.refetch);
  return <AfterState status={status} stamp={read.stamp} rows={isolatedAfterRows(isolatedRisk(read.state, sides), sides)} title={title} />;
}

/** Success screen, lender: the lent balance after the receipt. */
export function LenderAfterState({
  read,
  symbol,
  decimals,
  receiptBlock,
}: {
  read: IsolatedAccountRead;
  symbol: string;
  decimals: number;
  receiptBlock: bigint | undefined;
}) {
  const status = afterReadStatus({ receiptBlock, stamp: read.stamp, failed: read.failed, settled: read.settled });
  useCatchUp(status === "reading", read.refetch);
  return <AfterState status={status} stamp={read.stamp} rows={[{ label: "Lent balance", value: formatToken(read.lent, decimals, symbol) }]} />;
}
