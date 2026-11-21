import type { IsolatedMarketSides } from "@/lib/risk";
import type { IsolatedAccountRead } from "./reads";

/** Which side of a pair is which (for the liquidation-price direction); undefined until the pair loads. */
export function isolatedSides(
  info: { assetSymbol: string; collateralSymbol: string; assetDecimals: number; collateralDecimals: number } | undefined,
): IsolatedMarketSides | undefined {
  if (!info) return undefined;
  return {
    assetSymbol: info.assetSymbol,
    collateralSymbol: info.collateralSymbol,
    assetDecimals: info.assetDecimals,
    collateralDecimals: info.collateralDecimals,
  };
}

/**
 * The pair oracle's state for a price-gated action (borrow; remove collateral while in debt).
 * It allows the action only when BOTH the polled pair info and the modal's own stamped read say
 * the price is good (U4 review r1 #3), so the gate never contradicts the summary built from that
 * read, nor a poll that saw bad data first:
 * - "bad": either source flags bad data;
 * - "unreadable": either source could not read the flag;
 * - "loading": the modal's read has not answered yet (the polled info says the price is good);
 * - "ok": both say it is good.
 */
export type IsolatedOracleGate = "ok" | "bad" | "unreadable" | "loading";

export function isolatedOracleGate(
  polledBadData: boolean | undefined,
  read: Pick<IsolatedAccountRead, "state" | "settled">,
): IsolatedOracleGate {
  if (polledBadData === true || read.state.isBadData === true) return "bad";
  if (polledBadData === undefined) return "unreadable";
  if (read.state.isBadData === undefined) return read.settled ? "unreadable" : "loading";
  return "ok";
}
