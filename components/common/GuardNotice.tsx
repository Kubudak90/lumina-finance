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
        guard.borrowAllowed ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300" : "bg-amber-500/10 border-amber-500/30 text-amber-300"
      }`}
    >
      <p className="font-mono uppercase tracking-wider text-[10px]">Borrow status: {guard.key}</p>
      <p>{guard.message}</p>
      {!guard.borrowAllowed && <p className="text-muted-foreground">{GUARD_BLOCKED_NOTE[venue]}</p>}
    </div>
  );
}
