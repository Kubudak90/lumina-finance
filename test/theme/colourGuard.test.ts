/**
 * Colour-literal guard (spec ui-light-theme §3.2): app/, components/, lib/ and providers/ use theme
 * tokens only. It rejects
 * - raw Tailwind palette utilities (text-emerald-400, bg-white/5, border-red-500/30, …),
 * - hex colour literals (#B0C4FF),
 * - rgb()/rgba()/hsl()/hsla() literals; hsl(var(--token)) is a token reference and allowed.
 *
 * Allow-list (documented):
 * - app/globals.css: custom-property declarations (`--token: …;`), where the token values live.
 * - lib/theme/theme.ts: RainbowKit's theme API takes literal colours; ALLOWED lists the four exact
 *   accent literals (dark keeps today's accent, light equals the light --accent token, which the
 *   contrast test checks).
 * - Static assets are not scanned: app/icon.svg, app/apple-icon.svg and public/** are brand logos and
 *   token images with fixed colours (spec §3.2).
 * - HTML character references (&#10003;) are not colours.
 *
 * Also checked here: focus-scoped outlines instead of `outline-none` (spec §3.1, r2 #2), the forced
 * colours and print rules, and the Tailwind mapping of opaque and alpha tokens.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "@/tailwind.config";
import { globalsCss, repoRoot } from "../support/themeCss";

const SCANNED_DIRS = ["app", "components", "lib", "providers"];

const ALLOWED: { file: string; literal: string; why: string }[] = [
  { file: "lib/theme/theme.ts", literal: "#B0C4FF", why: "RainbowKit darkTheme accentColor (today's brand accent)" },
  { file: "lib/theme/theme.ts", literal: "#09090b", why: "RainbowKit darkTheme accentColorForeground (unchanged)" },
  { file: "lib/theme/theme.ts", literal: "#1d4ed8", why: "RainbowKit lightTheme accentColor = light --accent" },
  { file: "lib/theme/theme.ts", literal: "#ffffff", why: "RainbowKit lightTheme accentColorForeground = light --accent-foreground" },
];

const PALETTE =
  "(?:emerald|green|amber|yellow|orange|red|rose|blue|sky|indigo|zinc|gray|slate|neutral|stone|white|black|lime|teal|cyan|violet|purple|fuchsia|pink)";
const UTILITY =
  "(?:text|bg|border(?:-[xytrbl])?|ring|ring-offset|fill|stroke|from|to|via|outline|divide|placeholder|decoration|caret|shadow|accent)";
const RULES: { name: string; pattern: RegExp }[] = [
  { name: "palette utility", pattern: new RegExp(`(?<![\\w-])${UTILITY}-${PALETTE}(?:-\\d{2,3})?(?:\\/(?:\\d+|\\[[^\\]]+\\]))?(?![\\w-])`, "g") },
  { name: "hex literal", pattern: /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g },
  // Not \b: inside an arbitrary Tailwind value the literal follows an underscore (shadow-[0_0_20px_rgba(…)]).
  { name: "rgb/hsl literal", pattern: /(?<![A-Za-z])(?:rgba?|hsla?)\((?!\s*var\()/g },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|jsx|mjs|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const files = SCANNED_DIRS.flatMap((dir) => walk(join(repoRoot, dir))).map((path) => ({
  rel: relative(repoRoot, path).split("\\").join("/"),
  source: readFileSync(path, "utf8"),
}));

/** CSS: blank out custom-property declarations (the token values), keeping line numbers. */
function withoutTokenDeclarations(css: string): string {
  return css.replace(/--[\w-]+\s*:[^;{}]*;/g, (decl) => decl.replace(/[^\n]/g, " "));
}

function findColourLiterals(rel: string, source: string) {
  const text = rel.endsWith(".css") ? withoutTokenDeclarations(source) : source;
  const hits: { rel: string; line: number; rule: string; literal: string }[] = [];
  for (const { name, pattern } of RULES) {
    for (const m of text.matchAll(pattern)) {
      const line = text.slice(0, m.index).split("\n").length;
      if (ALLOWED.some((a) => a.file === rel && a.literal === m[0])) continue;
      hits.push({ rel, line, rule: name, literal: m[0] });
    }
  }
  return hits;
}

describe("colour-literal guard (spec §3.2)", () => {
  it("scans app/, components/, lib/ and providers/ (globals.css included)", () => {
    expect(files.some((f) => f.rel === "app/globals.css")).toBe(true);
    expect(files.some((f) => f.rel === "lib/lighter/runtime/session.tsx")).toBe(true);
    expect(files.some((f) => f.rel === "providers/Web3Provider.tsx")).toBe(true);
  });

  it("finds no raw colour outside the allow-list", () => {
    const hits = files.flatMap(({ rel, source }) => findColourLiterals(rel, source));
    expect(hits.map((h) => `${h.rel}:${h.line} ${h.rule} ${h.literal}`)).toEqual([]);
  });

  it("every allow-list entry is still used (no stale exceptions)", () => {
    for (const a of ALLOWED) {
      const source = files.find((f) => f.rel === a.file)?.source ?? "";
      expect(source.includes(`"${a.literal}"`), `${a.file} ${a.literal}`).toBe(true);
    }
  });

  it("its patterns catch what they should and nothing else", () => {
    const sample = (src: string, rel = "components/x.tsx") => findColourLiterals(rel, src).map((h) => h.literal);
    expect(sample('className="text-emerald-400 bg-white/5 hover:bg-white border-red-500/30 bg-white/[0.02] text-white"')).toEqual([
      "text-emerald-400",
      "bg-white/5",
      "bg-white",
      "border-red-500/30",
      "bg-white/[0.02]",
      "text-white",
    ]);
    expect(sample('stroke="#B0C4FF" shadow-[0_0_20px_rgba(176,196,255,0.2)] style={{ color: "hsl(0 0% 0%)" }}')).toEqual([
      "#B0C4FF",
      "rgba(",
      "hsl(",
    ]);
    // Token classes, token references, entities and look-alikes pass.
    expect(
      sample('className="text-success-strong bg-overlay border-border text-text-dim bg-accent-dim" fill="hsl(var(--card))" &#10003; white-space'),
    ).toEqual([]);
    // CSS: literals are allowed only inside custom-property declarations.
    expect(sample(":root { --x: rgba(0, 0, 0, 0.5); }\n.a { color: #fff; }", "app/x.css")).toEqual(["#fff"]);
  });
});

describe("focus, forced colours and print (spec §3.1)", () => {
  it("uses no outline-none on focusable elements: focus-scoped transparent outlines instead", () => {
    const offenders = files.filter(({ source }) => /(?<![\w-])outline-none(?![\w-])/.test(source)).map((f) => f.rel);
    expect(offenders).toEqual([]);
    const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent";
    for (const rel of [
      "components/ui/button.tsx",
      "components/ui/input.tsx",
      "components/ui/dialog.tsx",
      "components/ui/tabs.tsx",
      "components/markets/MarketTable.tsx",
      "components/theme/ThemeSelector.tsx",
      "app/(app)/dashboard/page.tsx",
      "app/(app)/liquidations/page.tsx",
    ]) {
      expect(files.find((f) => f.rel === rel)!.source, rel).toContain(FOCUS);
    }
  });

  it("borders meter and switch tracks and keeps bars visible in forced colours; drops the print background", () => {
    const forced = /@media \(forced-colors: active\) \{([\s\S]*?)\n\}/.exec(globalsCss)?.[1] ?? "";
    expect(forced).toMatch(/\.meter-track,\s*\.toggle-track \{\s*border: 1px solid CanvasText;/);
    expect(forced).toMatch(/\.meter-bar \{\s*forced-color-adjust: none;\s*background-color: Highlight;/);
    expect(forced).toMatch(/\.toggle-thumb \{\s*forced-color-adjust: none;/);
    expect(globalsCss).toMatch(/@media print \{\s*body \{\s*background-image: none;/);
    const src = (rel: string) => files.find((f) => f.rel === rel)!.source;
    expect(src("components/common/HealthFactorBar.tsx")).toMatch(/meter-track[^"]*bg-gauge-track/);
    expect(src("components/common/HealthFactorBar.tsx")).toContain("meter-bar");
    expect(src("components/markets/MarketTable.tsx")).toMatch(/meter-track[^"]*bg-gauge-track/);
    expect(src("app/(app)/dashboard/page.tsx")).toContain("toggle-track");
    expect(src("app/(app)/dashboard/page.tsx")).toMatch(/toggle-thumb[^\n]*bg-switch-thumb/);
  });

  it("has no html color-scheme rule left (one value per theme block instead)", () => {
    expect(globalsCss).not.toMatch(/html\s*\{[^}]*color-scheme/);
  });
});

describe("Tailwind config (spec §3.1)", () => {
  const colors = tailwindConfig.theme!.extend!.colors as Record<string, Record<string, string> | string>;

  it("scans lib/ and providers/ for classes", () => {
    expect(tailwindConfig.content).toEqual(
      expect.arrayContaining(["./lib/**/*.{js,ts,jsx,tsx}", "./providers/**/*.{js,ts,jsx,tsx}"]),
    );
  });

  it("makes dark: follow the app theme, not only the OS", () => {
    expect(tailwindConfig.darkMode).toEqual([
      "variant",
      ['@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) & }', '[data-theme="dark"] &'],
    ]);
  });

  it("maps opaque tokens with <alpha-value> and alpha tokens as plain var()", () => {
    expect(colors.background).toBe("hsl(var(--background) / <alpha-value>)");
    expect(colors["text-dim"]).toBe("hsl(var(--text-dim) / <alpha-value>)");
    expect(colors.success).toEqual({
      DEFAULT: "hsl(var(--success) / <alpha-value>)",
      strong: "hsl(var(--success-strong) / <alpha-value>)",
      fg: "hsl(var(--success-fg) / <alpha-value>)",
      surface: "var(--success-surface)",
      border: "var(--success-border)",
      "surface-subtle": "var(--success-surface-subtle)",
    });
    expect(colors.overlay).toEqual({ DEFAULT: "var(--overlay)", subtle: "var(--overlay-subtle)" });
    expect(colors.scrim).toBe("var(--scrim)");
    expect(colors["dialog-scrim"]).toBe("var(--dialog-scrim)");
    expect(colors["status-dot-neutral"]).toBe("var(--status-dot-neutral)");
    expect((colors.switch as Record<string, string>).track).toBe("var(--switch-track)");
    // No fixed colour remains in the config.
    expect(JSON.stringify(tailwindConfig)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
