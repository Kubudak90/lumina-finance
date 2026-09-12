"use client";

import { SLIPPAGE_OPTIONS, type SlippageBps } from "@/lib/slippage";

interface Props {
  value: SlippageBps;
  onChange: (bps: SlippageBps) => void;
}

export function SlippageSelector({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Max slippage
      </label>
      <div className="flex gap-2">
        {SLIPPAGE_OPTIONS.map((option) => (
          <button
            key={option.bps}
            type="button"
            onClick={() => onChange(option.bps)}
            className={`flex-1 h-10 font-mono font-bold text-sm transition-colors ${
              value === option.bps
                ? "bg-accent text-background shadow-[0_0_20px_rgba(176,196,255,0.2)]"
                : "border border-accent/30 text-accent hover:bg-accent hover:text-background"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
