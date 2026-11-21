import type { FreshnessStatus } from "@/lib/portfolio/combine";

const LABEL: Record<FreshnessStatus, string> = {
  fresh: "Fresh",
  stale: "Stale",
  offline: "Offline",
  unknown: "Unknown",
};

const TONE: Record<FreshnessStatus, string> = {
  fresh: "bg-success-surface text-success-fg border-success-border",
  stale: "bg-warning-surface text-warning-fg border-warning-border",
  offline: "bg-destructive-surface text-destructive-fg border-destructive-border",
  unknown: "bg-overlay text-text-dim border-border",
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
          status === "fresh" ? "bg-success-strong" : status === "stale" ? "bg-warning-strong" : "bg-destructive-strong"
        }`}
      />
      {source}
      <span className="text-foreground/80">{LABEL[status]}</span>
      {detail ? <span className="text-text-dim normal-case tracking-normal">{detail}</span> : null}
    </span>
  );
}
