// @vitest-environment happy-dom
/**
 * The theme selector (spec ui-light-theme §3.3, §6 #1): a labelled radio group of three icon-only
 * options with arrow-key navigation, the current choice checked; no checked option before hydration
 * (r2 #5); identical server markup for every stored choice, and hydration without a mismatch.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMatchMedia, installStorage, resetHtml } from "../support/themeEnv";

const KEY = "lumina.theme";

async function load() {
  vi.resetModules();
  const { ThemeProvider } = await import("@/providers/ThemeProvider");
  const { ThemeSelector } = await import("@/components/theme/ThemeSelector");
  return (
    <ThemeProvider>
      <ThemeSelector />
    </ThemeProvider>
  );
}

const radios = () => screen.getAllByRole("radio");
const radio = (name: string) => screen.getByRole("radio", { name });
const checkedNames = () => radios().filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.getAttribute("aria-label"));
const tabStops = () => radios().filter((r) => r.tabIndex === 0).map((r) => r.getAttribute("aria-label"));

beforeEach(() => {
  resetHtml();
  installMatchMedia(true);
});
afterEach(() => cleanup());

describe("theme selector", () => {
  it("is a labelled radio group with three labelled, icon-only options", async () => {
    installStorage();
    render(await load());
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((o) => o.getAttribute("aria-label"))).toEqual(["Light", "System", "Dark"]);
    for (const o of options) {
      expect(o.textContent).toBe(""); // icon only, named by aria-label
      expect(o.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(o.getAttribute("type")).toBe("button");
    }
  });

  it("checks the stored choice, which is the only tab stop", async () => {
    for (const [stored, label] of [
      ["light", "Light"],
      ["dark", "Dark"],
      ["system", "System"],
      ["nonsense", "System"],
    ]) {
      installStorage({ [KEY]: stored });
      render(await load());
      expect(checkedNames(), stored).toEqual([label]);
      expect(tabStops(), stored).toEqual([label]);
      cleanup();
    }
  });

  it("a click chooses, remembers and applies the theme", async () => {
    const storage = installStorage();
    render(await load());
    fireEvent.click(radio("Dark"));
    expect(checkedNames()).toEqual(["Dark"]);
    expect(storage.data.get(KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    fireEvent.click(radio("System"));
    expect(checkedNames()).toEqual(["System"]);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("arrow keys, Home and End move focus and choose, wrapping at the ends", async () => {
    installStorage({ [KEY]: "light" });
    render(await load());
    radio("Light").focus();
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    const state = () => [document.activeElement?.getAttribute("aria-label"), ...checkedNames(), ...tabStops()];

    press("ArrowRight");
    expect(state()).toEqual(["System", "System", "System"]);
    press("ArrowDown");
    expect(state()).toEqual(["Dark", "Dark", "Dark"]);
    press("ArrowRight"); // wraps
    expect(state()).toEqual(["Light", "Light", "Light"]);
    press("ArrowLeft"); // wraps back
    expect(state()).toEqual(["Dark", "Dark", "Dark"]);
    press("ArrowUp");
    expect(state()).toEqual(["System", "System", "System"]);
    press("Home");
    expect(state()).toEqual(["Light", "Light", "Light"]);
    press("End");
    expect(state()).toEqual(["Dark", "Dark", "Dark"]);
    expect(localStorage.getItem(KEY)).toBe("dark");
    press("a"); // other keys do nothing
    expect(state()).toEqual(["Dark", "Dark", "Dark"]);
  });

  it("renders no checked option on the server, the same markup for every stored choice", async () => {
    const markup: string[] = [];
    for (const stored of ["light", "dark", "system"]) {
      installStorage({ [KEY]: stored });
      markup.push(renderToString(await load()));
    }
    expect(new Set(markup).size).toBe(1);
    expect(markup[0]).not.toContain('aria-checked="true"');
    expect(markup[0].match(/aria-checked="false"/g)).toHaveLength(3);
    expect(markup[0].match(/tabindex="0"/gi)).toHaveLength(1); // still reachable by keyboard
  });

  it("hydrates without a mismatch, then checks the stored choice", async () => {
    installStorage({ [KEY]: "light" });
    const tree = await load();
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => errors.push(args));
    await act(async () => {
      hydrateRoot(container, tree, { onRecoverableError: (error) => errors.push(error) });
    });
    spy.mockRestore();
    expect(errors).toEqual([]);
    expect(checkedNames()).toEqual(["Light"]);
    container.remove();
  });
});
