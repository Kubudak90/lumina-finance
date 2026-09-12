import type { FreshnessStatus } from "@/lib/portfolio/combine";

const LABEL: Record<FreshnessStatus, string> = {
  live: "Live",
  stale: "Stale",
  offline: "Offline",
  unknown: "Unknown",
};

const TONE: Record<FreshnessStatus, string> = {
  live: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  stale: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  offline: "bg-red-500/15 text-red-300 border-red-500/30",
  unknown: "bg-white/5 text-text-dim border-border",
};

export function FreshnessBadge({
  source,
  status,
  detail,
}: {
  source: string;
  status: FreshnessStatus;
  detail?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono uppercase tracking-wider border ${TONE[status]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "live" ? "bg-emerald-400" : status === "stale" ? "bg-amber-400" : "bg-red-400"
        }`}
      />
      {source}
      <span className="text-foreground/80">{LABEL[status]}</span>
      {detail ? <span className="text-text-dim normal-case tracking-normal">{detail}</span> : null}
    </span>
  );
}
