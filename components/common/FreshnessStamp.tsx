"use client";

import { useFreshnessNow } from "@/lib/portfolio/clock";
import { blockAgeSeconds, chainFreshness } from "@/lib/portfolio/combine";
import { STALE_AFTER_SECONDS } from "@/lib/queryPolicy";
import type { BlockStamp } from "@/hooks/useBlockStamp";

/** "as of block N · Xs ago" for data read at a known block (FE-07). */
export function FreshnessStamp({ stamp, label }: { stamp: BlockStamp | undefined; label?: string }) {
  const now = useFreshnessNow();
  if (!stamp) {
    return <span className="text-[10px] font-mono text-text-dim">{label ? `${label}: ` : ""}no data yet</span>;
  }
  const age = blockAgeSeconds(stamp.timestamp, now);
  const status = chainFreshness(stamp.timestamp, now, STALE_AFTER_SECONDS);
  return (
    <span
      className={`text-[10px] font-mono ${status === "stale" ? "text-warning-strong" : "text-text-dim"}`}
      title={status === "stale" ? "Data is older than expected; the RPC may be lagging." : undefined}
    >
      {label ? `${label}: ` : ""}as of block {stamp.number.toString()}
      {age === null ? "" : ` · ${age}s ago`}
      {status === "stale" ? " (stale)" : ""}
    </span>
  );
}
