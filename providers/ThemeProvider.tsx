"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { readPreference, readResolved, subscribe, writePreference } from "@/lib/theme/store";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme/theme";

export interface ThemeState {
  /** The stored choice ("system" on the server and during hydration). */
  preference: ThemePreference;
  /** The theme in effect ("dark" on the server and during hydration). */
  resolved: ResolvedTheme;
  /**
   * False on the server and while hydrating, true afterwards. Theme-dependent props (RainbowKit, the
   * Toaster, the selector's checked option) wait for it, so the hydration markup equals the server's.
   */
  mounted: boolean;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

const subscribeNever = () => () => {};
const serverPreference = (): ThemePreference => "system";
const serverResolved = (): ResolvedTheme => "dark";

/**
 * Theme state for the whole app (spec ui-light-theme §3.3). The DOM's colours come from CSS and
 * `<html data-theme>` (set before first paint by the inline head script), so the deterministic server
 * snapshot only affects React-rendered theme props, which switch after hydration.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribe, readPreference, serverPreference);
  const resolved = useSyncExternalStore(subscribe, readResolved, serverResolved);
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const value = useMemo<ThemeState>(
    () => ({ preference, resolved, mounted, setPreference: writePreference }),
    [preference, resolved, mounted],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
