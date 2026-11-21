/**
 * The inline <head> theme script (spec ui-light-theme §3.3, §6 #1, r1 #10). The exact string as it is
 * serialised into the page is run in an isolated vm context with only stubbed `document` and
 * `localStorage`: a script that leaned on a closure or another global would fail here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThemeScript } from "@/components/theme/ThemeScript";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme/theme";
import { repoRoot } from "../support/themeCss";

/** The script as the server renders it into <head>. */
function servedScript(): string {
  const html = renderToStaticMarkup(<ThemeScript />);
  const m = /^<script>([\s\S]*)<\/script>$/.exec(html);
  if (!m) throw new Error(`unexpected markup: ${html}`);
  return m[1];
}

function run(storage: { getItem: (key: string) => string | null } | (() => never)) {
  const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
  const context: Record<string, unknown> = { document: { documentElement: root } };
  if (typeof storage === "function") Object.defineProperty(context, "localStorage", { get: storage });
  else context.localStorage = storage;
  runInNewContext(servedScript(), context);
  return root;
}

const stored = (value: string | null) => ({
  getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null),
});

describe("inline theme script", () => {
  it("is served verbatim from the fixed string constant", () => {
    expect(servedScript()).toBe(THEME_INIT_SCRIPT);
    expect(typeof THEME_INIT_SCRIPT).toBe("string");
  });

  it("applies a stored Light or Dark choice to <html data-theme>", () => {
    for (const theme of ["light", "dark"]) {
      const root = run(stored(theme));
      expect(root.setAttribute).toHaveBeenCalledWith("data-theme", theme);
      expect(root.removeAttribute).not.toHaveBeenCalled();
    }
  });

  it("removes data-theme for system, no value and invalid values", () => {
    for (const value of ["system", null, "blue", "", "Dark", "light "]) {
      const root = run(stored(value));
      expect(root.setAttribute, String(value)).not.toHaveBeenCalled();
      expect(root.removeAttribute, String(value)).toHaveBeenCalledWith("data-theme");
    }
  });

  it("does not throw when storage throws (getItem, or the localStorage getter itself)", () => {
    const throwingGetItem = run({
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(throwingGetItem.setAttribute).not.toHaveBeenCalled();
    const throwingGetter = run(() => {
      throw new Error("SecurityError");
    });
    expect(throwingGetter.setAttribute).not.toHaveBeenCalled();
  });

  it("is rendered in the root layout's <head>, and <html> no longer hard-codes the dark class", () => {
    const layout = readFileSync(join(repoRoot, "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/<head>\s*<ThemeScript \/>\s*<\/head>/);
    expect(layout).toMatch(/<html[^>]*suppressHydrationWarning/);
    const htmlClass = /<html[^>]*className=\{`([^`]*)`\}/.exec(layout)?.[1];
    expect(htmlClass).toBeDefined();
    expect(htmlClass!.split(/\s+/)).not.toContain("dark");
  });

  it("the root layout nests ThemeProvider > Web3Provider > children + ThemedToaster", () => {
    const layout = readFileSync(join(repoRoot, "app/layout.tsx"), "utf8").replace(/\s+/g, " ");
    expect(layout).toContain("<ThemeProvider> <Web3Provider> {children} <ThemedToaster /> </Web3Provider> </ThemeProvider>");
    expect(layout).not.toMatch(/<Toaster\b/);
  });
});
