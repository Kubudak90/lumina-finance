import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")
) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** `lighter-ts@1.0.2` peer ranges plus the exact SDK pin. */
const LIGHTER_TS_PEERS: Record<string, RegExp> = {
  react: /^19\.(?:[1-9]\d*|[2-9])\./,
  "@tanstack/react-query": /^\^?5\.(?:10[0-9]|1[1-9]\d|[2-9]\d{2})\./,
  zustand: /^\^?5\.(?:0\.(?:1[3-9]|[2-9]\d)|[1-9])/,
  zod: /^\^?[4-9]\./,
  i18next: /^\^?2[6-9]\./,
  "date-fns": /^\^?[4-9]\./,
  "decimal.js": /^\^?10\.(?:[6-9]|[1-9]\d)/,
  "lodash-es": /^\^?4\.(?:1[8-9]|[2-9]\d)/,
  "zklighter-perps": /^\^?1\.(?:0\.(?:30[3-9]|[4-9]\d{2})|[1-9])/,
};

describe("lighter-ts peer pins", () => {
  it("does not keep ConnectKit (React 18-only peers)", () => {
    expect(pkg.dependencies.connectkit).toBeUndefined();
    expect(pkg.dependencies["@rainbow-me/rainbowkit"]).toBeTruthy();
  });

  it("pins every lighter-ts@1.0.2 peer without --legacy-peer-deps", () => {
    expect(pkg.devDependencies["@types/react"]).toMatch(/^19\.(?:[1-9]\d*|[2-9])\./);

    expect(pkg.dependencies["lighter-ts"]).toBe("1.0.2");

    for (const [name, range] of Object.entries(LIGHTER_TS_PEERS)) {
      const version = pkg.dependencies[name];
      expect(version, `missing peer pin: ${name}`).toBeTruthy();
      expect(version, `${name}@${version} does not satisfy lighter-ts`).toMatch(range);
    }
  });
});
