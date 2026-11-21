/**
 * Theme constants shared by the server layout, the client store and the tests (spec ui-light-theme
 * §3.3). No DOM access here.
 */

/** localStorage key for the theme choice (per browser). */
export const THEME_STORAGE_KEY = "lumina.theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/** The OS preference the "system" choice follows. */
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/** A stored or passed value; anything other than light/dark/system means "system". */
export function parsePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

/**
 * The inline `<head>` script, as a fixed string (never a serialised function, so it cannot depend on a
 * closure). It runs before first paint: a stored "light" or "dark" sets `data-theme` on `<html>`;
 * anything else, or storage that throws, leaves the system theme (no attribute). The CSP already allows
 * inline scripts ('unsafe-inline', FE-02), so it needs no CSP change.
 */
export const THEME_INIT_SCRIPT =
  '(function(){try{var t=localStorage.getItem("lumina.theme"),r=document.documentElement;if(t==="light"||t==="dark"){r.setAttribute("data-theme",t)}else{r.removeAttribute("data-theme")}}catch(e){}})();';

/**
 * RainbowKit's theme API takes literal colours (allow-listed in the colour-literal guard). Dark keeps
 * today's accent; the light accent is the light `--accent` token as hex (the contrast test checks it).
 */
export const RAINBOW_ACCENTS = {
  dark: { accentColor: "#B0C4FF", accentColorForeground: "#09090b" },
  light: { accentColor: "#1d4ed8", accentColorForeground: "#ffffff" },
} as const;
