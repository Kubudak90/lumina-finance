/**
 * Reads the theme tokens from app/globals.css and does the colour maths for the contrast test
 * (WCAG 2.x relative luminance and contrast ratio, alpha compositing).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const globalsCss = readFileSync(join(repoRoot, "app/globals.css"), "utf8");

export const LIGHT_SELECTOR = ":root";
export const DARK_MEDIA = "@media (prefers-color-scheme: dark)";
export const DARK_MEDIA_SELECTOR = ':root:not([data-theme="light"])';
export const DARK_SELECTOR = ':root[data-theme="dark"]';

/** Strips comments, then returns the body of the first block whose prelude is exactly `prelude`. */
export function blockBody(css: string, prelude: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      const head = source.slice(start, i).trim();
      if (head === prelude) {
        let inner = 1;
        let j = i + 1;
        for (; j < source.length && inner > 0; j++) {
          if (source[j] === "{") inner++;
          else if (source[j] === "}") inner--;
        }
        return source.slice(i + 1, j - 1);
      }
      start = i + 1;
    } else if (ch === "}" || ch === ";") {
      start = i + 1;
    }
  }
  throw new Error(`no block "${prelude}" in globals.css`);
}

/** The declarations of a block (nested blocks skipped), in order. */
export function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      current = "";
      continue;
    }
    if (depth > 0) continue;
    if (ch === ";") {
      const at = current.indexOf(":");
      if (at > 0) out.set(current.slice(0, at).trim(), current.slice(at + 1).trim());
      current = "";
    } else current += ch;
  }
  return out;
}

export function themeBlocks() {
  const light = declarations(blockBody(globalsCss, LIGHT_SELECTOR));
  const darkMedia = declarations(blockBody(blockBody(globalsCss, DARK_MEDIA), DARK_MEDIA_SELECTOR));
  const dark = declarations(blockBody(globalsCss, DARK_SELECTOR));
  return { light, darkMedia, dark };
}

export type Rgba = [number, number, number, number];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return (lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [f(0), f(8), f(4)];
}

/** A token value: an HSL triplet, hsl(H S% L% [/ A]), rgb[a](r, g, b[, a]) or #hex. */
export function parseColour(value: string): Rgba {
  const v = value.trim();
  let m = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(v);
  if (m) return [...hslToRgb(+m[1], +m[2], +m[3]), 1];
  m = /^hsla?\(\s*(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(v);
  if (m) return [...hslToRgb(+m[1], +m[2], +m[3]), m[4] === undefined ? 1 : +m[4]];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)).concat(1) as Rgba;
  throw new Error(`not a colour: "${value}"`);
}

export function toHex([r, g, b]: Rgba): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

/** `top` (with its alpha) over an opaque `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
