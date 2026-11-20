import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler rules shipped with eslint-config-next 16. Existing
      // approval → action effects trip them; keep visible without failing CI.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    // FE-03: contract reads/writes go through hooks/chain, which pins every call to chain 19529.
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: ["hooks/chain/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "wagmi",
              importNames: [
                "useReadContract",
                "useReadContracts",
                "usePublicClient",
                "useWriteContract",
                "useSimulateContract",
                "useWaitForTransactionReceipt",
                "useWalletClient",
                "useSendTransaction",
                "useBlockNumber",
                "useBalance",
              ],
              message: "Use the chain-pinned wrappers in @/hooks/chain.",
            },
            { name: "wagmi/actions", message: "Use the chain-pinned wrappers in @/hooks/chain." },
            { name: "wagmi/chains", message: "The lending app has one chain: lib/chains.ts." },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/lighter/**",
    // Vendored byte-identical from lumina-monorepo; linted there.
    "deployments/index.mjs",
  ]),
]);
