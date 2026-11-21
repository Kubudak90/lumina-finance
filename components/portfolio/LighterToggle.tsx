"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/** localStorage key for the portfolio's "Show Lighter" choice (per browser). */
export const SHOW_LIGHTER_KEY = "lumina.portfolio.showLighter";

const listeners = new Set<() => void>();
/** This session's choice, used only when storage is unavailable (private mode, blocked site data). */
let fallback = false;

function read(): boolean {
  try {
    return window.localStorage.getItem(SHOW_LIGHTER_KEY) === "1";
  } catch {
    return fallback;
  }
}

function write(value: boolean) {
  fallback = value;
  try {
    window.localStorage.setItem(SHOW_LIGHTER_KEY, value ? "1" : "0");
  } catch {
    // Storage unavailable: the choice lasts for this session only.
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
          className="px-3 py-1.5 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-all font-mono"
        >
          {show ? "Hide Lighter" : "Show Lighter"}
        </button>
      </div>
      {show && <div id="lighter-section">{children}</div>}
    </section>
  );
}
