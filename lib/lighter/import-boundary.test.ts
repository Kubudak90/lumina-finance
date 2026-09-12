import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage", "out", "build"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    if (/\.(ts|tsx|js|mjs|mts|cts)$/.test(entry.name)) out.push(path);
  }
  return out;
}

function posix(path: string): string {
  return relative(repoRoot, path).split("\\").join("/");
}

describe("lighter-ts import boundary", () => {
  it("keeps the SDK inside lib/lighter/runtime and tests", () => {
    const sdkImports: string[] = [];
    const runtimeImports: string[] = [];

    for (const file of walk(repoRoot)) {
      const rel = posix(file);
      const source = readFileSync(file, "utf8");
      if (/from\s+['"]lighter-ts['"]/.test(source) || /require\(\s*['"]lighter-ts['"]\s*\)/.test(source)) {
        sdkImports.push(rel);
      }
      if (
        /from\s+['"]@\/lib\/lighter\/runtime(?:\/[^'"]+)?['"]/.test(source) ||
        /import\(\s*['"]@\/lib\/lighter\/runtime/.test(source) ||
        /from\s+['"]\.\.?\/runtime(?:\/[^'"]+)?['"]/.test(source)
      ) {
        runtimeImports.push(rel);
      }
    }

    const allowedSdk = sdkImports.filter(
      (rel) => rel.startsWith("lib/lighter/runtime/") || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")
    );
    expect(sdkImports, `unexpected lighter-ts imports:\n${sdkImports.join("\n")}`).toEqual(allowedSdk);

    const allowedRuntime = runtimeImports.filter((rel) => {
      if (rel === "app/(app)/lighter/page.tsx") return true;
      if (rel.startsWith("lib/lighter/runtime/")) return true;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return true;
      return false;
    });
    expect(runtimeImports, `unexpected runtime imports:\n${runtimeImports.join("\n")}`).toEqual(
      allowedRuntime
    );

    const barrel = readFileSync(join(repoRoot, "lib/lighter/index.ts"), "utf8");
    expect(barrel).not.toMatch(/lighter-ts/);

    const page = readFileSync(join(repoRoot, "app/(app)/lighter/page.tsx"), "utf8");
    expect(page).toMatch(/next\/dynamic/);
    expect(page).toMatch(/ssr:\s*false/);
  });
});
