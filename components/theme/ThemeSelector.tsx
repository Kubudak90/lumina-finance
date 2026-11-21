"use client";

import { useRef, type KeyboardEvent } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useTheme } from "@/providers/ThemeProvider";
import type { ThemePreference } from "@/lib/theme/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * System / Light / Dark as a compact icon-only radio group (spec ui-light-theme §3.3): arrow keys,
 * Home and End move and choose; one roving tab stop. The checked option is a solid accent fill (not a
 * hue-only tint; forced colours paint it with Highlight, see globals.css). Before hydration no option
 * is checked (neutral styling), so a stored Light or Dark never flashes "System".
 */
export function ThemeSelector({ className = "" }: { className?: string }) {
  const { preference, mounted, setPreference } = useTheme();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = mounted ? preference : null;
  const tabStop = Math.max(
    0,
    OPTIONS.findIndex((option) => option.value === checked),
  );

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = OPTIONS.length - 1;
    let next: number;
    if (NEXT_KEYS.has(event.key)) next = index === last ? 0 : index + 1;
    else if (PREVIOUS_KEYS.has(event.key)) next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    setPreference(OPTIONS[next].value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`theme-selector inline-flex shrink-0 items-center border border-border bg-card p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, label, icon: Icon }, index) => (
        <button
          key={value}
          ref={(element) => {
            buttons.current[index] = element;
          }}
          type="button"
          role="radio"
          aria-checked={checked === value}
          aria-label={label}
          title={`${label} theme`}
          tabIndex={index === tabStop ? 0 : -1}
          onClick={() => setPreference(value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className="inline-flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center text-text-dim transition-colors hover:text-foreground aria-checked:bg-accent aria-checked:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
