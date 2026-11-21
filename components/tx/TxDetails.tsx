"use client";

import type { ReactNode } from "react";
import type { TxPreview } from "@/lib/txPreview";
import { TxPreviewCard } from "@/components/common/TxPreview";

/**
 * Collapsed "Details" (ui-usability-v1 §3.2): the raw call(s) this modal will send, derived from
 * the planned call(s) — the approval first when one is needed — so they can be checked before the
 * wallet prompt. Extra content (limits, estimates) can go below the calls.
 */
export function TxDetails({ calls, children }: { calls: readonly (TxPreview | null | undefined)[]; children?: ReactNode }) {
  const planned = calls.filter((c): c is TxPreview => !!c);
  if (planned.length === 0 && !children) return null;
  return (
    <details className="technical-border bg-background p-3 text-xs group" data-testid="tx-details">
      <summary className="cursor-pointer select-none font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Details</summary>
      <div className="mt-2 space-y-2">
        {planned.map((call, i) => (
          <div key={`${call.functionName}-${i}`} data-testid="tx-details-call">
            <p className="text-[10px] font-mono text-muted-foreground mb-1">
              {planned.length > 1 ? `Call ${i + 1} of ${planned.length}` : "Call"} · to <span className="break-all">{call.to}</span>
            </p>
            <TxPreviewCard preview={call} />
          </div>
        ))}
        {children}
      </div>
    </details>
  );
}
