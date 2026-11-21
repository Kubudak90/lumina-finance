/**
 * The CSS Tailwind actually emits with the app config (LT fix round, Gemini r1 #1–#3):
 * - `dark:` utilities keep the plain utility's specificity, so state classes still win in dark;
 * - every focus class used by the focusable primitives emits a rule (no Tailwind-4-only syntax), and
 *   the Button ring is 2 px, opaque and offset from the fill;
 * - the theme selector's checked option is a solid accent fill that hover does not override.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareSpecificity, compileUtilities, rulesFor, specificity } from "../support/tailwindCss";
import { globalsCss, repoRoot } from "../support/themeCss";

describe("dark: variant specificity (r1 #1)", () => {
  const classes = [
    "border-input",
    "dark:border-input",
    "focus-visible:border-ring",
    "aria-[invalid=true]:border-destructive",
    "dark:aria-[invalid=true]:border-destructive/50",
    "bg-transparent",
    "dark:bg-input/30",
    "disabled:bg-input/50",
  ];

  it("emits both dark selectors with the plain utility's specificity", async () => {
    const css = await compileUtilities({ raw: `<div class="${classes.join(" ")}"></div>` });
    for (const [darkClass, plainClass] of [
      ["dark:border-input", "border-input"],
      ["dark:bg-input/30", "bg-transparent"],
    ]) {
      const dark = rulesFor(css, darkClass);
      expect(dark.map((r) => r.atRules.join(" ")).sort(), darkClass).toEqual(["", "media (prefers-color-scheme: dark)"]);
      expect(dark.find((r) => r.atRules.length)!.selector).toContain(':where(:root:not([data-theme="light"]))');
      expect(dark.find((r) => !r.atRules.length)!.selector).toContain(':where([data-theme="dark"])');
      const plain = specificity(rulesFor(css, plainClass)[0].selector);
      for (const r of dark) expect(specificity(r.selector), r.selector).toEqual(plain);
    }
  });

  it("focus-visible: and aria-invalid: state classes still beat a dark: utility", async () => {
    const css = await compileUtilities({ raw: `<div class="${classes.join(" ")}"></div>` });
    const darkBorder = rulesFor(css, "dark:border-input").map((r) => specificity(r.selector));
    for (const state of ["focus-visible:border-ring", "aria-[invalid=true]:border-destructive", "disabled:bg-input/50"]) {
      const s = specificity(rulesFor(css, state)[0].selector);
      for (const d of darkBorder) expect(compareSpecificity(s, d), state).toBeGreaterThan(0);
    }
    // A dark: state utility has exactly the specificity of the state utility it refines.
    // (Tailwind 3.4 spells the invalid state aria-[invalid=true]:; the shadcn aria-invalid: is v4-only.)
    const darkInvalid = rulesFor(css, "dark:aria-[invalid=true]:border-destructive/50").map((r) => specificity(r.selector));
    const invalid = specificity(rulesFor(css, "aria-[invalid=true]:border-destructive")[0].selector);
    expect(darkInvalid).toHaveLength(2);
    for (const d of darkInvalid) expect(d).toEqual(invalid);
  });

  it("the specificity helper agrees with the CSS rules on known selectors", () => {
    expect(specificity(".a")).toEqual([0, 1, 0]);
    expect(specificity(":root:not([data-theme=\"light\"]) .dark\\:a")).toEqual([0, 3, 0]);
    expect(specificity(":where(:root:not([data-theme=\"light\"])) .dark\\:a")).toEqual([0, 1, 0]);
    expect(specificity("[data-theme=\"dark\"] .dark\\:a")).toEqual([0, 2, 0]);
    expect(specificity(".focus-visible\\:a:focus-visible")).toEqual([0, 2, 0]);
    expect(specificity("#x .y::before")).toEqual([1, 1, 1]);
  });
});

/** Class tokens with a focus variant in a source file. */
function focusClasses(rel: string): string[] {
  const source = readFileSync(join(repoRoot, rel), "utf8");
  return [...new Set(source.split(/[\s"'`{}()$,]+/).filter((t) => /(^|:)focus(-visible)?:[\w[]/.test(t)))];
}

const FOCUSABLE_SOURCES = [
  "components/ui/button.tsx",
  "components/ui/input.tsx",
  "components/ui/dialog.tsx",
  "components/theme/ThemeSelector.tsx",
  "components/markets/MarketTable.tsx",
  "app/(app)/dashboard/page.tsx",
  "app/(app)/liquidations/page.tsx",
];

describe("focus indicators emit real CSS (r1 #2)", () => {
  it("every focus class of the focusable primitives and inputs compiles to a rule", async () => {
    const css = await compileUtilities({ files: FOCUSABLE_SOURCES.map((rel) => join(repoRoot, rel)) });
    const dead = FOCUSABLE_SOURCES.flatMap((rel) => focusClasses(rel).filter((c) => rulesFor(css, c).length === 0).map((c) => `${rel}: ${c}`));
    expect(dead).toEqual([]);
  });

  it("Button: a 2 px opaque ring with a card-coloured 2 px offset; Input: a 2 px opaque ring", async () => {
    const button = focusClasses("components/ui/button.tsx");
    const input = focusClasses("components/ui/input.tsx");
    expect(button).toEqual(
      expect.arrayContaining(["focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2", "focus-visible:ring-offset-card"]),
    );
    expect(input).toEqual(expect.arrayContaining(["focus-visible:ring-2", "focus-visible:ring-ring"]));
    expect([...button, ...input].filter((c) => /ring-ring\//.test(c))).toEqual([]); // opaque ring colour

    const css = await compileUtilities({ raw: button.join(" ") });
    const decl = (name: string) => rulesFor(css, name)[0].declarations;
    expect(decl("focus-visible:ring-2")["--tw-ring-shadow"]).toContain("calc(2px + var(--tw-ring-offset-width))");
    expect(decl("focus-visible:ring-ring")["--tw-ring-color"]).toBe("hsl(var(--ring) / var(--tw-ring-opacity, 1))");
    expect(decl("focus-visible:ring-offset-2")["--tw-ring-offset-width"]).toBe("2px");
    expect(decl("focus-visible:ring-offset-card")["--tw-ring-offset-color"]).toBe("hsl(var(--card) / 1)");
  });

  it("the search inputs mark focus with an opaque accent border", () => {
    for (const rel of ["app/(app)/dashboard/page.tsx", "app/(app)/liquidations/page.tsx"]) {
      const classes = focusClasses(rel);
      expect(classes, rel).toContain("focus:border-accent");
      expect(classes.filter((c) => c.startsWith("focus:border-accent/")), rel).toEqual([]);
    }
  });
});

describe("theme selector checked option (r1 #3)", () => {
  const selectorSource = "components/theme/ThemeSelector.tsx";

  it("is a solid accent fill with accent-foreground, which hover does not override", async () => {
    const source = readFileSync(join(repoRoot, selectorSource), "utf8");
    expect(source).toContain("aria-checked:bg-accent ");
    expect(source).toContain("aria-checked:text-accent-foreground");
    expect(source).not.toMatch(/aria-checked:bg-accent\//);
    const css = await compileUtilities({ files: [join(repoRoot, selectorSource)] });
    const checkedText = rulesFor(css, "aria-checked:text-accent-foreground")[0];
    const hoverText = rulesFor(css, "hover:text-foreground")[0];
    expect(checkedText.selector).toContain('[aria-checked="true"]');
    expect(rulesFor(css, "aria-checked:bg-accent")[0].declarations["background-color"]).toBe(
      "hsl(var(--accent) / var(--tw-bg-opacity, 1))",
    );
    expect(specificity(checkedText.selector)).toEqual(specificity(hoverText.selector));
    expect(checkedText.order).toBeGreaterThan(hoverText.order); // later wins: checked stays readable on hover
  });

  it("keeps a Highlight fill in forced colours, scoped to the selector", () => {
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(globalsCss)?.[1] ?? "";
    expect(forced).toMatch(
      /\.theme-selector \[role="radio"\]\[aria-checked="true"\] \{\s*forced-color-adjust: none;\s*background-color: Highlight;\s*color: HighlightText;/,
    );
    expect(readFileSync(join(repoRoot, selectorSource), "utf8")).toMatch(/role="radiogroup"[\s\S]*className=\{`theme-selector /);
  });
});
