/**
 * The theme choice as an external store (read through useSyncExternalStore, spec ui-light-theme §3.3).
 *
 * - `preference` ("system" | "light" | "dark") is stored in localStorage. Reads and writes are wrapped
 *   in try/catch; while storage cannot be written the choice lasts for the session (`unsaved`), and an
 *   invalid stored value means "system".
 * - `resolved` ("light" | "dark") is the explicit choice, or the OS preference under "system". A live
 *   matchMedia listener re-renders on an OS change; it has no effect while an explicit theme is set.
 * - The DOM is never touched from a render: the inline head script applies the stored choice before
 *   first paint. Afterwards `<html data-theme>` is re-applied from storage when the first subscriber
 *   attaches (after hydration: storage may have changed between the head script and hydration without
 *   a `storage` event reaching this page), on a choice, on another tab's choice, and on a back/forward
 *   cache restore.
 */
import { DARK_SCHEME_QUERY, THEME_STORAGE_KEY, parsePreference, type ResolvedTheme, type ThemePreference } from "./theme";

const listeners = new Set<() => void>();
/** This session's choice while storage cannot be written; `null` while storage works. */
let unsaved: ThemePreference | null = null;
let detach: (() => void) | null = null;

export function readPreference(): ThemePreference {
  if (unsaved !== null) return unsaved;
  try {
    return parsePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
  } catch {
    // No matchMedia: CSS cannot see the OS preference either, so the light :root tokens apply.
    return "light";
  }
}

export function readResolved(): ResolvedTheme {
  const preference = readPreference();
  return preference === "system" ? systemTheme() : preference;
}

/** An explicit choice sets `data-theme` on <html>; "system" removes it (the CSS media query decides). */
export function applyPreference(preference: ThemePreference, root: HTMLElement = document.documentElement) {
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

function emit() {
  for (const listener of [...listeners]) listener();
}

export function writePreference(value: ThemePreference) {
  const preference = parsePreference(value);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    unsaved = null;
  } catch {
    // Storage not writable: the choice lasts for this session only.
    unsaved = preference;
  }
  applyPreference(preference);
  emit();
}

/** Re-reads the stored choice, puts it on <html> and re-renders subscribers. */
function resync() {
  applyPreference(readPreference());
  emit();
}

function attach(): () => void {
  const cleanups: (() => void)[] = [];
  // Subscribing happens in a commit effect, after hydration: safe to touch the DOM here.
  applyPreference(readPreference());
  try {
    const media = window.matchMedia(DARK_SCHEME_QUERY);
    media.addEventListener("change", emit);
    cleanups.push(() => media.removeEventListener("change", emit));
  } catch {
    // No matchMedia: "system" stays on the light tokens.
  }
  const onStorage = (event: StorageEvent) => {
    // Another tab changed the choice (key null: storage was cleared).
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    if (unsaved !== null) return;
    resync();
  };
  window.addEventListener("storage", onStorage);
  cleanups.push(() => window.removeEventListener("storage", onStorage));
  // Restored from the back/forward cache: the page kept its old state while another tab may have
  // changed the choice.
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) resync();
  };
  window.addEventListener("pageshow", onPageShow);
  cleanups.push(() => window.removeEventListener("pageshow", onPageShow));
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  if (detach === null) detach = attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && detach !== null) {
      detach();
      detach = null;
    }
  };
}
