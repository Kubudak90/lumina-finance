/**
 * Static checks over the source tree (the S9 grep checks, kept in CI):
 * - no unlimited approval / delegation constants, no retired-testnet chain or copy, no deployer key,
 *   no off-chain price API;
 * - wagmi contract hooks and actions only inside hooks/chain (every read and write pinned);
 * - no looping / leverage surface, no admin listing page, no faucet.
 *
 * The vendored S6 files (deployments/index.mjs, deployments/lighter-devnet.json) are byte-identical
 * copies and are excluded: the loader names the archived testnet environment so it can refuse
 * it, and the manifest lists the leaked EOA in its `compromised` deny-list.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifestJson from "../deployments/lighter-devnet.json";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage", "out", "build", ".worktrees", "public"]);
const VENDORED = new Set(["deployments/index.mjs", "deployments/lighter-devnet.json"]);
const SELF = "lib/scope.test.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|mjs|mts|cts|json|md|yml|yaml)$|^\.env/.test(entry.name)) out.push(path);
  }
  return out;
}

const files = walk(repoRoot)
  .map((path) => ({ rel: relative(repoRoot, path).split("\\").join("/"), path }))
  .filter(({ rel }) => rel !== "package-lock.json" && rel !== SELF && !VENDORED.has(rel))
  .map(({ rel, path }) => ({ rel, source: readFileSync(path, "utf8") }));
const code = files.filter(({ rel }) => /\.(ts|tsx|mjs|js)$/.test(rel));

/** Patterns are assembled from pieces so this file does not match itself. */
const p = (...parts: string[]) => parts.join("");

function offenders(pattern: RegExp, scope = files) {
  return scope.filter(({ source }) => pattern.test(source)).map(({ rel }) => rel);
}

describe("grep checks", () => {
  it("has no unlimited approval or delegation constant", () => {
    expect(offenders(new RegExp(p("MAX_UINT", "256|max", "Uint256")))).toEqual([]);
    expect(offenders(new RegExp(p("approve", "Delegation|borrow", "Allowance")))).toEqual([]);
  });

  it("has no retired-testnet chain id or copy", () => {
    expect(offenders(new RegExp(p("845", "32")))).toEqual([]);
    expect(offenders(new RegExp(p("base[ -]", "sepolia|base", "scan"), "i"))).toEqual([]);
  });

  it("reads no deployer or private key, and has no cron route", () => {
    expect(offenders(new RegExp(p("DEPLOYER_", "PRIVATE_KEY")))).toEqual([]);
    expect(offenders(/process\.env\.[A-Z_]*(PRIVATE|SECRET|MNEMONIC)/, code)).toEqual([]);
    expect(existsSync(join(repoRoot, "app/api"))).toBe(false);
  });

  it("never mentions a compromised address outside the manifest deny-list", () => {
    expect(manifestJson.compromised.length).toBeGreaterThan(0);
    for (const address of manifestJson.compromised) {
      expect(offenders(new RegExp(address.slice(2), "i"))).toEqual([]);
    }
  });

  it("has no CoinGecko price path", () => {
    expect(offenders(new RegExp(p("coin", "gecko\\.com"), "i"), code)).toEqual([]);
  });
});

describe("chain pinning (FE-03)", () => {
  const RESTRICTED_HOOKS = [
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
  ];
  const ALLOWED = (rel: string) => rel.startsWith("hooks/chain/");

  it("imports wagmi contract hooks only in hooks/chain", () => {
    const bad: string[] = [];
    for (const { rel, source } of code) {
      if (ALLOWED(rel)) continue;
      for (const m of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']wagmi(\/[a-z]+)?["']/g)) {
        const names = m[1].split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
        if (m[2] === "/actions") bad.push(`${rel}: wagmi/actions`);
        for (const name of names) if (RESTRICTED_HOOKS.includes(name)) bad.push(`${rel}: ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("sends and simulates only through the pinned wrapper", () => {
    const sites = offenders(/\b(writeContract(Async)?|simulateContract|sendTransaction)\s*\(/, code);
    expect(sites).toEqual(["hooks/chain/index.ts"]);
    const wrapper = code.find(({ rel }) => rel === "hooks/chain/index.ts")!.source;
    expect(wrapper).toMatch(/useWaitForTransactionReceipt\(\{[^}]*chainId: LUMINA_CHAIN_ID/);
    expect(wrapper).toMatch(/usePublicClient\(\{ chainId: LUMINA_CHAIN_ID \}\)/);
    expect(wrapper).toMatch(/pinChainId\(parameters, LUMINA_CHAIN_ID\)/);
    expect(wrapper).toMatch(/pinContracts\(contractList, LUMINA_CHAIN_ID\)/);
    expect(wrapper).toMatch(/executePinnedWrite\(/);
  });

  it("keeps Ethereum mainnet out of the lending config", () => {
    expect(offenders(/from\s+["']wagmi\/chains["']|viem\/chains/, code)).toEqual([]);
  });
});

describe("scope (spec §3.3, non-goals)", () => {
  it("has no looping / leverage routes, modals or ABIs", () => {
    for (const route of ["app/(app)/leverage", "app/(app)/faucet", "app/(app)/admin"]) {
      expect(existsSync(join(repoRoot, route)), route).toBe(false);
    }
    expect(offenders(/openPosition|closePosition|leveragedPosition|repayAssetWithCollateral|LOOPING_ABI/, code)).toEqual([]);
    expect(offenders(/href=["'`]\/(leverage|faucet|admin)/, code)).toEqual([]);
    expect(offenders(/LeverageCloseModal|useDebtDelegation/, code)).toEqual([]);
  });

  it("has no UI that writes a network name into on-chain token names", () => {
    expect(offenders(/networkName|networkAbbreviation|listAssets/, code)).toEqual([]);
  });
});
