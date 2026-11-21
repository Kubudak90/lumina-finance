// @vitest-environment happy-dom
/**
 * Theme state (spec ui-light-theme §3.3, §5 #1–#3, §6 #1): preference read and write (storage
 * throwing, invalid values, session fallback), the resolved theme and its live system listener.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMatchMedia, installStorage, otherTabWrites, resetHtml } from "../support/themeEnv";

const KEY = "lumina.theme";

async function load() {
  vi.resetModules();
  const store = await import("@/lib/theme/store");
  const provider = await import("@/providers/ThemeProvider");
  return { store, provider };
}

const html = () => document.documentElement;

beforeEach(() => resetHtml());
afterEach(() => cleanup());

describe("preference read and write", () => {
  it("reads light, dark and system; a missing or invalid value means system", async () => {
    installMatchMedia(false);
    for (const [stored, expected] of [
      ["light", "light"],
      ["dark", "dark"],
      ["system", "system"],
      ["blue", "system"],
      ["", "system"],
      ["DARK", "system"],
    ] as const) {
      installStorage({ [KEY]: stored });
      const { store } = await load();
      expect(store.readPreference(), stored).toBe(expected);
    }
    installStorage();
    const { store } = await load();
    expect(store.readPreference()).toBe("system");
  });

  it("storage that throws on read, or on access, means system", async () => {
    installMatchMedia(true);
    const storage = installStorage({ [KEY]: "light" });
    storage.failGet = true;
    let { store } = await load();
    expect(store.readPreference()).toBe("system");
    expect(store.readResolved()).toBe("dark");

    installStorage({ [KEY]: "light" }, { throwOnAccess: true });
    ({ store } = await load());
    expect(store.readPreference()).toBe("system");
  });

  it("a write stores the choice, sets or removes <html data-theme> and notifies subscribers", async () => {
    installMatchMedia(false);
    const storage = installStorage();
    const { store } = await load();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.writePreference("dark");
    expect(storage.data.get(KEY)).toBe("dark");
    expect(html().getAttribute("data-theme")).toBe("dark");
    expect(store.readPreference()).toBe("dark");

    store.writePreference("light");
    expect(html().getAttribute("data-theme")).toBe("light");

    store.writePreference("system");
    expect(storage.data.get(KEY)).toBe("system");
    expect(html().hasAttribute("data-theme")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("an invalid value passed in is written as system", async () => {
    installMatchMedia(false);
    const storage = installStorage();
    const { store } = await load();
    store.writePreference("sepia" as never);
    expect(storage.data.get(KEY)).toBe("system");
    expect(html().hasAttribute("data-theme")).toBe(false);
  });

  it("when storage cannot be written the choice still works for the session", async () => {
    installMatchMedia(false);
    const storage = installStorage({ [KEY]: "light" });
    storage.failSet = true;
    const { store } = await load();
    store.writePreference("dark");
    expect(storage.data.get(KEY)).toBe("light"); // nothing persisted
    expect(store.readPreference()).toBe("dark"); // the session choice wins over the stale stored value
    expect(store.readResolved()).toBe("dark");
    expect(html().getAttribute("data-theme")).toBe("dark");

    // Storage works again: the next write persists and the session fallback is dropped.
    storage.failSet = false;
    store.writePreference("light");
    expect(storage.data.get(KEY)).toBe("light");
    storage.data.set(KEY, "dark");
    expect(store.readPreference()).toBe("dark");
  });

  it("with storage throwing everywhere the selector still works for the session", async () => {
    installMatchMedia(false);
    installStorage({}, { throwOnAccess: true });
    const { store } = await load();
    store.writePreference("dark");
    expect(store.readPreference()).toBe("dark");
    expect(html().getAttribute("data-theme")).toBe("dark");
  });
});

describe("resolved theme and the system listener", () => {
  function Probe({ useTheme }: { useTheme: () => { preference: string; resolved: string; mounted: boolean } }) {
    const t = useTheme();
    return <div data-testid="probe" data-preference={t.preference} data-resolved={t.resolved} data-mounted={String(t.mounted)} />;
  }
  const probe = () => screen.getByTestId("probe").dataset;

  it("system follows the OS; an explicit choice wins over it", async () => {
    installMatchMedia(true);
    installStorage({ [KEY]: "system" });
    let { store } = await load();
    expect(store.readResolved()).toBe("dark");

    installMatchMedia(false);
    ({ store } = await load());
    expect(store.readResolved()).toBe("light");

    installMatchMedia(false);
    installStorage({ [KEY]: "dark" });
    ({ store } = await load());
    expect(store.readResolved()).toBe("dark");
  });

  it("switches live when the OS changes under system, and not under an explicit theme", async () => {
    const media = installMatchMedia(false);
    installStorage({ [KEY]: "system" });
    const { store, provider } = await load();
    render(
      <provider.ThemeProvider>
        <Probe useTheme={provider.useTheme} />
      </provider.ThemeProvider>,
    );
    expect(probe()).toMatchObject({ preference: "system", resolved: "light", mounted: "true" });

    act(() => media.setDark(true));
    expect(probe().resolved).toBe("dark");
    act(() => media.setDark(false));
    expect(probe().resolved).toBe("light");

    act(() => store.writePreference("dark"));
    expect(probe()).toMatchObject({ preference: "dark", resolved: "dark" });
    act(() => media.setDark(false));
    act(() => media.setDark(true));
    act(() => media.setDark(false));
    expect(probe().resolved).toBe("dark");
    expect(html().getAttribute("data-theme")).toBe("dark");
  });

  it("applies a choice made in another tab", async () => {
    installMatchMedia(false);
    const storage = installStorage({ [KEY]: "system" });
    const { provider } = await load();
    render(
      <provider.ThemeProvider>
        <Probe useTheme={provider.useTheme} />
      </provider.ThemeProvider>,
    );
    act(() => otherTabWrites(storage, KEY, "dark"));
    expect(probe()).toMatchObject({ preference: "dark", resolved: "dark" });
    expect(html().getAttribute("data-theme")).toBe("dark");
    act(() => otherTabWrites(storage, "unrelated", "x"));
    expect(probe().preference).toBe("dark");
    act(() => otherTabWrites(storage, KEY, null));
    expect(probe().preference).toBe("system");
    expect(html().hasAttribute("data-theme")).toBe(false);
  });

  it("detaches the OS listener when the last subscriber leaves", async () => {
    const media = installMatchMedia(false);
    installStorage();
    const { store } = await load();
    const a = store.subscribe(() => {});
    const b = store.subscribe(() => {});
    expect(media.listenerCount()).toBe(1);
    a();
    expect(media.listenerCount()).toBe(1);
    b();
    expect(media.listenerCount()).toBe(0);
  });

  it("useTheme outside a ThemeProvider throws", async () => {
    installMatchMedia(false);
    installStorage();
    const { provider } = await load();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe useTheme={provider.useTheme} />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});
