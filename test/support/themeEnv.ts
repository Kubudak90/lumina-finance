/**
 * Controllable localStorage and matchMedia for the theme tests (happy-dom). Each test installs fresh
 * fakes and re-imports the theme modules (vi.resetModules), so the store's session state is clean.
 */
import { vi } from "vitest";

export interface FakeStorage {
  data: Map<string, string>;
  failGet: boolean;
  failSet: boolean;
}

export interface FakeMedia {
  matches: boolean;
  /** Flip the OS preference and fire `change` like a browser does. */
  setDark(dark: boolean): void;
  listenerCount(): number;
}

export function installStorage(initial: Record<string, string> = {}, opts: { throwOnAccess?: boolean } = {}): FakeStorage {
  const state: FakeStorage = { data: new Map(Object.entries(initial)), failGet: false, failSet: false };
  const storage = {
    getItem: (key: string) => {
      if (state.failGet) throw new Error("SecurityError: storage blocked");
      return state.data.has(key) ? state.data.get(key)! : null;
    },
    setItem: (key: string, value: string) => {
      if (state.failSet) throw new Error("QuotaExceededError");
      state.data.set(key, String(value));
    },
    removeItem: (key: string) => {
      state.data.delete(key);
    },
    clear: () => state.data.clear(),
    key: (i: number) => [...state.data.keys()][i] ?? null,
    get length() {
      return state.data.size;
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => {
      if (opts.throwOnAccess) throw new Error("SecurityError: access denied");
      return storage;
    },
  });
  return state;
}

export function installMatchMedia(dark: boolean): FakeMedia {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media: FakeMedia = {
    matches: dark,
    setDark(next: boolean) {
      media.matches = next;
      for (const l of [...listeners]) l({ matches: next });
    },
    listenerCount: () => listeners.size,
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      get matches() {
        return query === "(prefers-color-scheme: dark)" ? media.matches : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, l: (event: { matches: boolean }) => void) => listeners.add(l),
      removeEventListener: (_type: string, l: (event: { matches: boolean }) => void) => listeners.delete(l),
      addListener: (l: (event: { matches: boolean }) => void) => listeners.add(l),
      removeListener: (l: (event: { matches: boolean }) => void) => listeners.delete(l),
      dispatchEvent: () => true,
    })),
  });
  return media;
}

/** Fire the `storage` event another tab's write would cause. */
export function otherTabWrites(storage: FakeStorage, key: string, value: string | null) {
  if (value === null) storage.data.delete(key);
  else storage.data.set(key, value);
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
}

export function resetHtml() {
  document.documentElement.removeAttribute("data-theme");
}
