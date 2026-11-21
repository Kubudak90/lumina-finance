/**
 * Contrast of the theme tokens in app/globals.css (spec ui-light-theme §6 #1, r1 #6, r2 #3, r2 #4).
 *
 * - Text pairs need >= 4.5:1, UI pairs (gauges, rings, borders, switches) >= 3:1.
 * - Translucent tokens are composited over their real backdrop (card or background) before measuring.
 * - Light: every pair is required.
 * - Dark: the same pairs are measured. Dark must look exactly as before the light theme, so the pairs
 *   that were already below the threshold are listed in DARK_EXCEPTIONS with today's ratio; the test
 *   fails on any other dark pair below the threshold, on a listed pair that got worse, and on a stale
 *   entry (a listed pair that now passes or no longer exists).
 *
 * Set CONTRAST_REPORT=1 to print the measured table.
 */
import { describe, expect, it } from "vitest";
import { RAINBOW_ACCENTS } from "@/lib/theme/theme";
import { composite, contrast, parseColour, themeBlocks, toHex, type Rgba } from "../support/themeCss";

type Theme = "light" | "dark";
type Paint = string | { top: string; alpha?: number; over: Paint };
interface Pair {
  group: string;
  fg: Paint;
  bg: Paint;
  min: number;
  themes?: Theme[];
}

const TEXT = 4.5;
const UI = 3;
const STATUSES = ["success", "warning", "danger", "destructive", "info"] as const;
const over = (top: string, under: Paint, alpha?: number): Paint => ({ top, alpha, over: under });

/** The exact pair list of spec §6 #1. */
const SPEC_PAIRS: Pair[] = [
  // Text >= 4.5:1.
  { group: "text", fg: "foreground", bg: "background", min: TEXT },
  { group: "text", fg: "foreground", bg: "card", min: TEXT },
  { group: "text", fg: "muted-foreground", bg: "card", min: TEXT },
  { group: "text", fg: "muted-foreground", bg: "background", min: TEXT },
  { group: "text", fg: "text-dim", bg: "card", min: TEXT },
  { group: "text", fg: "text-dim", bg: "background", min: TEXT },
  { group: "text", fg: "accent-strong", bg: "card", min: TEXT },
  { group: "text", fg: "accent-strong", bg: "background", min: TEXT },
  ...STATUSES.flatMap((s): Pair[] => [
    { group: "text", fg: `${s}-fg`, bg: over(`${s}-surface`, "card"), min: TEXT },
    { group: "text", fg: `${s}-fg`, bg: over(`${s}-surface`, "background"), min: TEXT },
    { group: "text", fg: `${s}-fg`, bg: "card", min: TEXT },
  ]),
  { group: "text", fg: "accent-foreground", bg: "accent", min: TEXT },
  { group: "text", fg: "primary-foreground", bg: "primary", min: TEXT },
  { group: "text", fg: "destructive-foreground", bg: "destructive", min: TEXT },
  // UI >= 3:1. Gauge bars: the four statuses, "unavailable" (muted-foreground) and utilization (accent).
  ...["success", "warning", "danger", "destructive", "muted-foreground", "accent"].map(
    (bar): Pair => ({ group: "ui", fg: bar, bg: "gauge-track", min: UI }),
  ),
  { group: "ui", fg: "ring", bg: "card", min: UI },
  { group: "ui", fg: "ring", bg: "background", min: UI },
  { group: "ui", fg: "border", bg: "card", min: UI },
  { group: "ui", fg: "input", bg: "card", min: UI },
  { group: "ui", fg: over("switch-track", "card"), bg: "card", min: UI },
  { group: "ui", fg: "accent", bg: "card", min: UI },
  { group: "ui", fg: "switch-thumb", bg: over("switch-track", "card"), min: UI },
  { group: "ui", fg: "switch-thumb", bg: "accent", min: UI },
  // Text use of the fills (r2 #3): APY cells, chart tooltips, links, validation errors.
  ...[...STATUSES, "accent", "primary"].flatMap((t): Pair[] => [
    { group: "fill-as-text", fg: t, bg: "card", min: TEXT },
    { group: "fill-as-text", fg: t, bg: "background", min: TEXT },
  ]),
];

/** Pairs this implementation adds: every other token pairing the UI actually renders. */
const EXTRA_PAIRS: Pair[] = [
  // Status text on card and page (most status text uses the -strong token).
  ...STATUSES.flatMap((s): Pair[] => [
    { group: "status-text", fg: `${s}-strong`, bg: "card", min: TEXT },
    { group: "status-text", fg: `${s}-strong`, bg: "background", min: TEXT },
  ]),
  // CTA hover keeps its label readable.
  { group: "extra-text", fg: "accent-foreground", bg: "accent-hover", min: TEXT },
  // Brand text on a 10% brand tint (active sidebar item, MAX button, the selector's checked option).
  { group: "extra-text", fg: "accent", bg: over("accent", "background", 0.1), min: TEXT },
  { group: "extra-text", fg: "accent", bg: over("accent", "card", 0.1), min: TEXT },
  // RPC chain banner (spec §3.2: an accessible alert surface).
  { group: "extra-text", fg: "alert-foreground", bg: over("alert", "background", 0.9), min: TEXT },
  // TokenIcon fallback letters.
  { group: "extra-text", fg: "muted-foreground", bg: "accent-dim", min: TEXT },
  // Banners with today's lighter tints: GuardNotice (open 5%, blocked 10%), DeploymentNotice and the
  // EnableCollateral notice (10%, amber-400 heading), the NetworkGuard switch button (20% on the 15% banner).
  { group: "extra-text", fg: "success-fg", bg: over("success-surface-subtle", "background"), min: TEXT },
  { group: "extra-text", fg: "warning-fg", bg: over("warning-surface-subtle", "background"), min: TEXT },
  { group: "extra-text", fg: "warning-fg", bg: over("warning-surface-subtle", "card"), min: TEXT },
  { group: "extra-text", fg: "warning-strong", bg: over("warning-surface-subtle", "card"), min: TEXT },
  { group: "extra-text", fg: "warning-fg", bg: over("warning", over("warning-surface", "background"), 0.2), min: TEXT },
  // Badge variant="destructive": 10% tint in light, 20% (its dark: variant) in dark.
  { group: "extra-text", fg: "destructive", bg: over("destructive", "card", 0.1), min: TEXT, themes: ["light"] },
  { group: "extra-text", fg: "destructive", bg: over("destructive", "card", 0.2), min: TEXT, themes: ["dark"] },
  // Neutral status dot (Unknown / Inactive markets) and the chart axes.
  { group: "extra-ui", fg: over("status-dot-neutral", "card"), bg: "card", min: UI },
  { group: "extra-ui", fg: "chart-axis", bg: "card", min: UI },
];

const PAIRS = [...SPEC_PAIRS, ...EXTRA_PAIRS];

/**
 * Dark pairs below the threshold before the light theme existed, with that ratio (rounded down). Dark
 * does not change, so these stay as they are; the test fails if one gets worse.
 */
const DARK_EXCEPTIONS: Record<string, number> = {
  // Liquidate buttons (r1 #6).
  "text: destructive-foreground on destructive": 3.62,
  // Hairline borders and inputs of the dark design.
  "ui: border on card": 1.15,
  "ui: input on card": 1.25,
  // Collateral switch: muted-foreground/30 off track; white thumb on the light-blue on track (r2 #1).
  "ui: switch-track over card on card": 1.57,
  "ui: switch-thumb on accent": 1.64,
  // TokenIcon fallback letters (r1 #8).
  "extra-text: muted-foreground on accent-dim": 4.18,
  // Badge variant="destructive" with its dark:bg-destructive/20 (r1 #6).
  "extra-text: destructive on destructive/0.2 over card": 4.03,
  // bg-white/30 dot of Unknown / Inactive markets (r1 #8); the status is also written next to it.
  "extra-ui: status-dot-neutral over card on card": 2.67,
};

function label(paint: Paint): string {
  if (typeof paint === "string") return paint;
  return `${paint.top}${paint.alpha === undefined ? "" : `/${paint.alpha}`} over ${label(paint.over)}`;
}
const pairId = (pair: Pair) => `${pair.group}: ${label(pair.fg)} on ${label(pair.bg)}`;

const blocks = themeBlocks();
const TOKENS: Record<Theme, Map<string, string>> = { light: blocks.light, dark: blocks.dark };

function token(theme: Theme, name: string): Rgba {
  const value = TOKENS[theme].get(`--${name}`);
  if (value === undefined) throw new Error(`--${name} is not defined for ${theme}`);
  return parseColour(value);
}

function paint(theme: Theme, p: Paint): Rgba {
  if (typeof p === "string") {
    const colour = token(theme, p);
    if (colour[3] !== 1) throw new Error(`${p} is translucent in ${theme}: measure it over its backdrop`);
    return colour;
  }
  const top = token(theme, p.top);
  const alpha = p.alpha ?? top[3];
  return composite([top[0], top[1], top[2], alpha], paint(theme, p.over));
}

function measure(theme: Theme) {
  return PAIRS.filter((pair) => !pair.themes || pair.themes.includes(theme)).map((pair) => ({
    id: pairId(pair),
    min: pair.min,
    ratio: contrast(paint(theme, pair.fg), paint(theme, pair.bg)),
  }));
}

const light = measure("light");
const dark = measure("dark");

if (process.env.CONTRAST_REPORT) {
  const row = (r: { id: string; min: number; ratio: number }) => `${r.id.padEnd(76)} ${(Math.floor(r.ratio * 100) / 100).toFixed(2).padStart(6)} (min ${r.min})`;
  console.log(`LIGHT\n${light.map(row).join("\n")}\n\nDARK\n${dark.map(row).join("\n")}`);
}

describe("theme contrast (spec §6 #1)", () => {
  it("has no duplicate pairs", () => {
    const ids = PAIRS.map(pairId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("light: every pair meets its threshold", () => {
    const failing = light.filter((r) => r.ratio < r.min).map((r) => `${r.id}: ${r.ratio.toFixed(2)} < ${r.min}`);
    expect(failing).toEqual([]);
  });

  it("dark: only the documented baseline pairs are below the threshold, and none got worse", () => {
    const problems: string[] = [];
    for (const r of dark) {
      const baseline = DARK_EXCEPTIONS[r.id];
      if (r.ratio >= r.min) {
        if (baseline !== undefined) problems.push(`${r.id}: listed as an exception but passes (${r.ratio.toFixed(2)})`);
      } else if (baseline === undefined) {
        problems.push(`${r.id}: ${r.ratio.toFixed(2)} < ${r.min} (new dark failure)`);
      } else if (r.ratio < baseline) {
        problems.push(`${r.id}: ${r.ratio.toFixed(2)} is worse than the baseline ${baseline}`);
      }
    }
    for (const id of Object.keys(DARK_EXCEPTIONS)) {
      if (!dark.some((r) => r.id === id)) problems.push(`${id}: exception for a pair that is not measured`);
    }
    expect(problems).toEqual([]);
  });
});

/**
 * Today's dark colours (before the light theme), by token: the shadcn tokens' old values, the old
 * Tailwind config colours, and the Tailwind palette classes and literals each new token replaces.
 */
const TODAY: Record<string, string> = {
  background: "240 6% 4%",
  foreground: "0 0% 100%",
  card: "240 5% 7%",
  "card-foreground": "0 0% 100%",
  popover: "240 5% 7%",
  "popover-foreground": "0 0% 100%",
  primary: "222 100% 85%",
  "primary-foreground": "240 6% 4%",
  secondary: "230 20% 20%",
  "secondary-foreground": "0 0% 100%",
  muted: "240 5% 13%",
  "muted-foreground": "225 5% 57%",
  accent: "222 100% 85%",
  "accent-foreground": "240 6% 4%",
  destructive: "0 84% 60%",
  "destructive-foreground": "0 0% 98%",
  border: "240 6% 13%",
  input: "240 6% 16%",
  ring: "222 100% 85%",
  "text-dim": "#8E9299", // tailwind.config text-dim
  "accent-dim": "#2A2D3F", // tailwind.config accent-dim
  "accent-strong": "#B0C4FF", // RateCurveChart borrow line, RainbowKit accent
  "accent-hover": "#ffffff", // hover:bg-white on CTAs
  success: "#10B981", // tailwind.config success = emerald-500 (bars, dots, chart line)
  "success-strong": "#34d399", // emerald-400 text
  "success-fg": "#6ee7b7", // emerald-300 pill/banner text
  "success-surface": "rgba(16, 185, 129, 0.15)", // bg-emerald-500/15
  "success-surface-subtle": "rgba(16, 185, 129, 0.05)", // bg-emerald-500/5 (GuardNotice)
  "success-border": "rgba(16, 185, 129, 0.3)", // border-emerald-500/30
  warning: "#F59E0B", // tailwind.config warning = amber-500
  "warning-strong": "#fbbf24", // amber-400
  "warning-fg": "#fcd34d", // amber-300
  "warning-surface": "rgba(245, 158, 11, 0.15)",
  "warning-surface-subtle": "rgba(245, 158, 11, 0.1)", // bg-amber-500/10 (notices)
  "warning-border": "rgba(245, 158, 11, 0.3)",
  danger: "#f97316", // orange-500
  "danger-strong": "#fb923c", // orange-400
  "danger-fg": "#fdba74", // orange-300
  "danger-surface": "rgba(249, 115, 22, 0.15)",
  "danger-border": "rgba(249, 115, 22, 0.3)",
  "destructive-strong": "#f87171", // red-400
  "destructive-fg": "#fca5a5", // red-300
  "destructive-surface": "rgba(239, 68, 68, 0.15)", // bg-red-500/15
  "destructive-border": "rgba(239, 68, 68, 0.3)",
  alert: "#dc2626", // red-600 (RPC banner at /90, NetworkGuard dot)
  "alert-foreground": "#ffffff", // text-white on the RPC banner
  "switch-thumb": "#ffffff", // bg-white
  "switch-track": "hsl(225 5% 57% / 0.3)", // bg-muted-foreground/30
  "gauge-track": "240 6% 13%", // bg-border
  "status-dot-neutral": "rgba(255, 255, 255, 0.3)", // bg-white/30
  "chart-axis": "#666666", // Recharts' default axis colour
  selection: "hsl(222 100% 85% / 0.3)",
  "grid-line": "rgba(255, 255, 255, 0.02)",
  glow: "rgba(176, 196, 255, 0.05)",
  overlay: "rgba(255, 255, 255, 0.05)", // bg-white/5
  "overlay-subtle": "rgba(255, 255, 255, 0.02)", // bg-white/[0.02]
  scrim: "rgba(0, 0, 0, 0.6)", // bg-black/60
  "dialog-scrim": "hsl(240 6% 4% / 0.8)", // bg-background/80
};
const TODAY_EFFECTS: Record<string, string> = {
  "text-glow": "0 0 10px rgba(176, 196, 255, 0.3)",
  "cta-shadow": "0 0 20px rgba(176, 196, 255, 0.2)",
  "cta-shadow-lg": "0 0 30px rgba(176, 196, 255, 0.25)",
};

describe("theme tokens", () => {
  const rounded = (c: Rgba) => [...c.slice(0, 3).map(Math.round), +c[3].toFixed(3)];

  it("declares the dark values twice, identically (OS dark media block and explicit Dark)", () => {
    expect([...blocks.darkMedia.entries()]).toEqual([...blocks.dark.entries()]);
  });

  it("defines every token in both themes", () => {
    const names = (m: Map<string, string>) => [...m.keys()].filter((k) => k.startsWith("--") && k !== "--radius").sort();
    expect(names(blocks.dark)).toEqual(names(blocks.light));
  });

  it("has one color-scheme per block: light on :root, dark in both dark blocks", () => {
    expect(blocks.light.get("color-scheme")).toBe("light");
    expect(blocks.darkMedia.get("color-scheme")).toBe("dark");
    expect(blocks.dark.get("color-scheme")).toBe("dark");
  });

  it("dark values equal today's colours", () => {
    const changed: string[] = [];
    for (const [name, today] of Object.entries(TODAY)) {
      const now = rounded(token("dark", name));
      if (JSON.stringify(now) !== JSON.stringify(rounded(parseColour(today)))) changed.push(`--${name}: ${now} != ${today}`);
    }
    for (const [name, today] of Object.entries(TODAY_EFFECTS)) {
      if (blocks.dark.get(`--${name}`) !== today) changed.push(`--${name}: ${blocks.dark.get(`--${name}`)} != ${today}`);
    }
    expect(changed).toEqual([]);
    // Every dark colour token has a recorded origin.
    const colourTokens = [...blocks.dark.keys()].filter((k) => k.startsWith("--") && !["--radius"].includes(k)).map((k) => k.slice(2));
    const untracked = colourTokens.filter((k) => !(k in TODAY) && !(k in TODAY_EFFECTS) && !k.startsWith("info"));
    expect(untracked).toEqual([]);
  });

  it("RainbowKit's accents are the theme accents", () => {
    expect(toHex(token("light", "accent"))).toBe(RAINBOW_ACCENTS.light.accentColor.toLowerCase());
    expect(toHex(token("light", "accent-foreground"))).toBe(RAINBOW_ACCENTS.light.accentColorForeground);
    expect(toHex(token("dark", "accent-strong"))).toBe(RAINBOW_ACCENTS.dark.accentColor.toLowerCase());
    expect(RAINBOW_ACCENTS.dark.accentColorForeground).toBe("#09090b");
  });
});
