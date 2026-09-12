"use client";

import { describeWrite, type TxPreview } from "@/lib/txPreview";

export function TxPreviewCard({ preview }: { preview: TxPreview | null }) {
  if (!preview) return null;
  return (
    <div className="technical-border bg-background p-3 space-y-1.5 text-xs">
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground">Call</span>
        <span className="font-mono">{preview.functionName}</span>
      </div>
      {preview.args.map((arg) => (
        <div key={arg.name} className="flex justify-between gap-2">
          <span className="text-muted-foreground">{arg.name}</span>
          <span className="font-mono truncate max-w-[220px]" title={arg.value}>
            {arg.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export { describeWrite };
