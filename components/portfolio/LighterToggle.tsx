"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/** localStorage key for the portfolio's "Show Lighter" choice (per browser). */
export const SHOW_LIGHTER_KEY = "lumina.portfolio.showLighter";

const listeners = new Set<() => void>();
/**
 * This session's choice while storage cannot be written (private mode, blocked site data, a full
 * quota): `null` while storage works. It wins over a readable-but-stale stored value, so the toggle
 * still opens and closes when only `setItem` throws (Gemini r1 #2).
 */
let unsaved: boolean | null = null;

function read(): boolean {
  if (unsaved !== null) return unsaved;
  try {
    return window.localStorage.getItem(SHOW_LIGHTER_KEY) === "1";
  } catch {
    return false;
  }
}

function write(value: boolean) {
  try {
    window.localStorage.setItem(SHOW_LIGHTER_KEY, value ? "1" : "0");
    unsaved = null;
  } catch {
    // Storage not writable: the choice lasts for this session only.
    unsaved = value;
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The remembered choice; collapsed on the server and by default. */
export function useShowLighter(): [boolean, (show: boolean) => void] {
  return [useSyncExternalStore(subscribe, read, () => false), write];
}

/**
 * The Lighter section behind a manual toggle (spec ui-usability-v1 §3.3, r1 #13): collapsed by
 * default, the choice remembered per browser. The page never inspects Lighter state, and the embed
 * (passed as children) is unchanged; while collapsed it is not mounted at all.
 */
export function LighterToggle({ children }: { children: ReactNode }) {
  const [show, setShow] = useShowLighter();
  return (
    <section aria-label="Lighter" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Lighter</h2>
          <p className="text-[10px] font-mono text-text-dim mt-1">Unified Lumina + Lighter view: perps and spot equity.</p>
        </div>
        <button
          type="button"
          aria-expanded={show}
          aria-controls="lighter-section"
          onClick={() => setShow(!show)}
          className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-accent-foreground transition-all font-mono"
        >
          {show ? "Hide Lighter" : "Show Lighter"}
        </button>
      </div>
      {show && <div id="lighter-section">{children}</div>}
    </section>
  );
}
