import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Pure tests next to the code; component / hook wiring tests (happy-dom) under test/.
    include: ["lib/**/*.test.ts", "test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/support/setup.ts"],
  },
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": root,
    },
  },
});
