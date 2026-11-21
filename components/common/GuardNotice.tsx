"use client";

import { GUARD_BLOCKED_NOTE } from "@/lib/guard";
import { useGuardStatus } from "@/hooks/useGuardStatus";

/** Why borrows are blocked (LuminaPriceGuard.borrowStatus). Renders nothing while borrows are open. */
export function GuardNotice({ venue, always = false }: { venue: "core" | "isolated"; always?: boolean }) {
  const guard = useGuardStatus();
  if (guard.isLoading) return null;
  if (guard.borrowAllowed && !always) return null;
  return (
    <div
      className={`technical-border p-3 text-xs space-y-1 ${
        guard.borrowAllowed ? "bg-success-surface-subtle border-success/20 text-success-fg" : "bg-warning-surface-subtle border-warning-border text-warning-fg"
      }`}
    >
      <p className="font-mono uppercase tracking-wider text-[10px]">Borrow status: {guard.key}</p>
      <p>{guard.message}</p>
      {!guard.borrowAllowed && <p className="text-muted-foreground">{GUARD_BLOCKED_NOTE[venue]}</p>}
    </div>
  );
}
