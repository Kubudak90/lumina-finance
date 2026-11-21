"use client";

import { useEffect, useState } from "react";
import { formatExactTokenAmount } from "@/lib/format";

/** After a confirmed transaction: the allowance that really remains, read from the chain. */
export function PostTxAllowance({
  refetch,
  symbol,
  decimals,
  spenderLabel,
}: {
  refetch: () => Promise<bigint | undefined>;
  symbol: string;
  decimals: number;
  spenderLabel: string;
}) {
  const [value, setValue] = useState<bigint | undefined | null>(null);
  useEffect(() => {
    let live = true;
    refetch().then(
      (v) => live && setValue(v),
      () => live && setValue(undefined),
    );
    return () => {
      live = false;
    };
    // Read once, when the success screen appears (after the receipt).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <p className="text-xs font-mono text-muted-foreground" data-testid="post-tx-allowance">
      Remaining allowance to {spenderLabel} (on-chain):{" "}
      {value === null
        ? "reading…"
        : value === undefined
          ? "unavailable"
          : `${formatExactTokenAmount(value, decimals)} ${symbol}`}
    </p>
  );
}
