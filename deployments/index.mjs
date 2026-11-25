// Lumina deployment manifest loader and validator.
//
// The single way scripts, bots and the frontend read `deployments/<env>.json`.
// Dependency-free ESM. It never imports a Node built-in at module load, so a bundler can include it
// in browser code: there, pass an already-imported manifest as `data`. Reading files needs
// Node >= 20.16 (`process.getBuiltinModule`).
//
//   import { loadManifest } from "../deployments/index.mjs";
//   const m = loadManifest({ env: "lighter-devnet" });            // strict: complete, deployed
//   const t = loadManifest({ chainId: 19529, strict: false });    // also accepts the template
//   const f = loadManifest({ chainId: 19529, data: importedJson }); // no file access
//
// The schema is documented in deployments/README.md.

export const SCHEMA_VERSION = 1;

/** Allowed signer sets for deployed manifests: "live" (default) or "harness" (Anvil tests only). */
export const SIGNER_SETS = Object.freeze(["live", "harness"]);

/**
 * The fixed layout of the Lighter EVM devnet deployment (spec 3.1, 3.2, 3.4, audit-fixes-v1 F1/F6).
 * validateManifest enforces it for environment "lighter-devnet": a manifest that encodes other
 * expectations is rejected, so snapshot-roles / verify-deployment can never pass against wrong
 * expectations. In a template, null fields are skipped but every value that is set must fit.
 */
const LIGHTER_DEVNET_LAYOUT = deepFreeze({
  // The leaked Base Sepolia EOA (0xf9D4...E512, full address in deployments/archive/base-sepolia.json)
  // must be in `compromised`. Only its keccak256 lives in code; the address itself is manifest data.
  compromisedKeccak: "0x0e9b2f63fed9bac36dab993082cd8c4b6e22f5f99b533480ee3817c23871bc14",
  // Allowed signer sets for `status: "deployed"` manifests (audit-fixes-v1 F6). `live` is the
  // committed launch keyset; `harness` is the Anvil test keyset (harness/deploy/lib/accounts.mjs).
  signerSets: {
    live: {
      deployer: "0x8B524a320Bf6e6BEAa793fa34ACB5EC3b2f23cE8",
      safeOwners: [
        "0x8ebE0590F24D8b89E887aE2f21008dD1efbe4C37",
        "0xF244919d74392A625f295e280ab90c54B11B4012",
        "0x9801AC65D2a2184316aEB2b5888C08dbBc6FdD8c",
      ],
      keeper: "0xDA19711321966B59d52c6ad44675EAA061248aB6",
      liquidator: "0xD41bDd4b32B9E8A08c0f355bEBE58B9d67a3c154",
    },
    harness: {
      deployer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      safeOwners: [
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
        "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
        "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
      ],
      keeper: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      liquidator: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    },
  },
  assets: {
    WETH: { address: "0x660000000000000000000000000000000000000c", decimals: 18 },
    USDC: { address: "0xf2A5728d366c6d0f764Af612cD47F3608E2B4d5B", decimals: 6 },
  },
  coreMarkets: ["WETH", "USDC"],
  isolatedMarkets: ["USDC/WETH", "WETH/USDC"], // asset/collateral
  coreSource: { asset: "WETH", marketId: 0 }, // WETH priced by the ETH perp index, Core market 0
  fixedSource: { asset: "USDC", price8: "100000000" }, // USDC = $1.00
  proxies: ["pool", "poolConfigurator"], // plus every aToken / variableDebtToken (markets.core)
  // Libraries linked into each implementation (Aave v3.2 PoolInstance / PoolConfiguratorInstance).
  implementationLibraries: {
    pool: ["BorrowLogic", "BridgeLogic", "EModeLogic", "FlashLoanLogic", "LiquidationLogic", "PoolLogic", "SupplyLogic"].map(
      (name) => `src/contracts/protocol/libraries/logic/${name}.sol:${name}`,
    ),
    poolConfigurator: ["src/contracts/protocol/libraries/logic/ConfiguratorLogic.sol:ConfiguratorLogic"],
  },
  // Safe v1.3.0 (spec 3.5): canonical singletons (Lighter preinstalls) and the
  // CompatibilityFallbackHandler deployed through SafeSingletonFactory (harness/lib/safe.mjs).
  safe: {
    owners: 3,
    threshold: 2,
    version: "1.3.0",
    singletons: ["0x69f4D1788e39c87893C980c06EdF4b7f686e2938", "0xfb1bffC9d739B8D520DaF37dF666da4C687191EA"],
    fallbackHandler: "0x017062a1dE2FE6b99BE3d9d37841FeD19F573804",
  },
  executorDelaySec: 86400, // Executor timelock: 1 day
  timelockDelaySec: 172800, // isolated Timelock: 2 days
});

/** Active environments. The loader resolves `env` and `chainId` only through this. */
export const ENVIRONMENTS = Object.freeze({
  "lighter-devnet": Object.freeze({ chainId: 19529, layout: LIGHTER_DEVNET_LAYOUT }),
});

/** Retired environments. Their manifests live in deployments/archive/ and are always refused. */
export const ARCHIVED_ENVIRONMENTS = Object.freeze({
  "base-sepolia": Object.freeze({ chainId: 84532, path: "archive/base-sepolia.json" }),
});

/** Contract keys every manifest must define (role snapshot and wiring checks read them by name). */
export const REQUIRED_CONTRACTS = Object.freeze([
  "poolAddressesProvider",
  "aclManager",
  "pool",
  "poolConfigurator",
  "aaveOracle",
  "poolDataProvider",
  "reserveInterestRateStrategy",
  "executor",
  "priceGuard",
  "isolatedTimelock",
  "isolatedDeployer",
  "isolatedRegistry",
  "isolatedWhitelist",
  "isolatedRateCalculator",
]);

/** Aave ACLManager roles: name -> role id (DEFAULT_ADMIN is 0x00, the others keccak256(name)). */
export const ACL_ROLE_NAMES = Object.freeze([
  "DEFAULT_ADMIN",
  "POOL_ADMIN",
  "EMERGENCY_ADMIN",
  "RISK_ADMIN",
  "FLASH_BORROWER",
  "BRIDGE",
  "ASSET_LISTING_ADMIN",
]);

const CORE_ROLE_FIELDS = Object.freeze([
  "poolAddressesProviderOwner",
  "aclAdmin",
  "executorOwner",
  "treasury",
]);
const GUARD_ROLE_FIELDS = Object.freeze(["guardian", "keeper"]);
const ISOLATED_ROLE_FIELDS = Object.freeze([
  "timelockAdmin",
  "deployerOwner",
  "deployerCircuitBreaker",
  "deployerComptroller",
  "deployerTimelock",
  "registryOwner",
  "whitelistOwner",
  "pairOwner",
  "pairTimelock",
  "pairCircuitBreaker",
]);

// Guard bounds, mirrored from LuminaPriceGuard (lumina-oracle contracts/lighter/LuminaPriceGuard.sol).
const GUARD_BOUNDS = Object.freeze({
  maxRefAgeSec: [30, 3600],
  maxDeviationBps: [10, 2000],
  maxCorePriceAgeSec: [180, 30 * 24 * 3600],
});

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const EMPTY_CODEHASH = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";

export class ManifestError extends Error {
  /** @param {string} message @param {string[]} [errors] every problem found, one per entry */
  constructor(message, errors) {
    super(errors && errors.length ? `${message}\n  - ${errors.join("\n  - ")}` : message);
    this.name = "ManifestError";
    this.errors = errors && errors.length ? errors : [message];
  }
}

// ------------------------------------------------------------------------------------------------
// Loading
// ------------------------------------------------------------------------------------------------

/**
 * Resolve the signer set: explicit `option`, else `process.env.LUMINA_SIGNER_SET`, else `"live"`.
 * Safe in browsers (no Node imports). Throws ManifestError on unknown values.
 */
export function resolveSignerSet(option) {
  const envVal = globalThis.process?.env?.LUMINA_SIGNER_SET;
  const chosen = option ?? (envVal ? envVal : "live");
  if (typeof chosen !== "string" || !SIGNER_SETS.includes(chosen)) {
    throw new ManifestError(`unknown signerSet ${JSON.stringify(chosen)} (allowed: ${SIGNER_SETS.join(", ")})`);
  }
  return chosen;
}

/**
 * Load and validate the manifest of one environment.
 * @param {object} options
 * @param {string} [options.env] environment name, e.g. "lighter-devnet"
 * @param {number} [options.chainId] chain id; resolved to its environment
 * @param {string|URL} [options.path] read this file instead of deployments/<env>.json
 * @param {object|string} [options.data] an already-loaded manifest (object or JSON text); no file access
 * @param {boolean} [options.strict=true] require a complete, deployed manifest (every address set)
 * @param {"live"|"harness"} [options.signerSet] allowed signer set for deployed manifests (default: LUMINA_SIGNER_SET or "live")
 * @returns {object} the validated manifest, deep-frozen
 */
export function loadManifest(options = {}) {
  const { env, chainId, path, data, strict = true, signerSet } = options;
  const resolved = resolveEnvironment(env, chainId);
  const chosenSignerSet = resolveSignerSet(signerSet);
  let manifest;
  if (data !== undefined) {
    manifest = typeof data === "string" ? parseJson(data, "data") : structuredClone(data);
  } else {
    const file = path ?? new URL(`./${resolved.env}.json`, import.meta.url);
    manifest = parseJson(readText(file), String(file));
  }
  validateManifest(manifest, { strict, env: resolved.env, chainId: resolved.chainId, signerSet: chosenSignerSet });
  return deepFreeze(manifest);
}

function resolveEnvironment(env, chainId) {
  if (env === undefined && chainId === undefined) {
    throw new ManifestError("loadManifest: pass `env` or `chainId`");
  }
  if (chainId !== undefined && !Number.isSafeInteger(chainId)) {
    throw new ManifestError(`loadManifest: chainId must be an integer, got ${JSON.stringify(chainId)}`);
  }
  if (env !== undefined) {
    if (ARCHIVED_ENVIRONMENTS[env]) {
      throw new ManifestError(
        `environment "${env}" is archived (deployments/${ARCHIVED_ENVIRONMENTS[env].path}); it cannot be loaded`,
      );
    }
    const known = ENVIRONMENTS[env];
    if (!known) throw new ManifestError(`unknown environment "${env}" (known: ${Object.keys(ENVIRONMENTS).join(", ")})`);
    if (chainId !== undefined && chainId !== known.chainId) {
      throw new ManifestError(`environment "${env}" is chain ${known.chainId}, not ${chainId}`);
    }
    return { env, chainId: known.chainId };
  }
  const match = Object.entries(ENVIRONMENTS).find(([, v]) => v.chainId === chainId);
  if (match) return { env: match[0], chainId };
  const archived = Object.entries(ARCHIVED_ENVIRONMENTS).find(([, v]) => v.chainId === chainId);
  if (archived) {
    throw new ManifestError(`chain ${chainId} (${archived[0]}) is archived; it cannot be loaded`);
  }
  throw new ManifestError(`no active manifest for chain ${chainId}`);
}

function readText(file) {
  const fs = globalThis.process?.getBuiltinModule?.("node:fs");
  if (!fs) {
    throw new ManifestError("loadManifest: reading files needs Node >= 20.16; pass the manifest as `data`");
  }
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new ManifestError(`cannot read manifest ${file}: ${err.message}`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ManifestError(`${label}: invalid JSON: ${err.message}`);
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// ------------------------------------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------------------------------------

/**
 * Validate a manifest object. Throws a ManifestError listing every problem; returns the object.
 *
 * `strict` (default true) requires `status: "deployed"`. A deployed manifest must be complete and
 * match the selected signer set even with `strict: false`; only `status: "template"` may contain
 * nulls. Archived manifests are always refused.
 *
 * @param {object} manifest
 * @param {{strict?: boolean, env?: string, chainId?: number, signerSet?: "live"|"harness"}} [options]
 */
export function validateManifest(manifest, options = {}) {
  const { strict = true, env, chainId, signerSet } = options;
  const chosenSignerSet = resolveSignerSet(signerSet);
  if (!isPlainObject(manifest)) throw new ManifestError("manifest must be a JSON object");
  if (manifest.archived !== undefined && manifest.archived !== false) {
    throw new ManifestError(
      `manifest "${manifest.environment ?? "?"}" is archived${manifest.archivedReason ? ` (${manifest.archivedReason})` : ""}; archived manifests are never loaded`,
    );
  }
  if (env !== undefined && manifest.environment !== env) {
    throw new ManifestError(`manifest environment is ${JSON.stringify(manifest.environment)}, expected "${env}"`);
  }
  if (chainId !== undefined && manifest.chainId !== chainId) {
    throw new ManifestError(`manifest chainId is ${JSON.stringify(manifest.chainId)}, expected ${chainId}`);
  }

  const v = new Validator();
  if (manifest.status === "template") {
    if (strict) v.err("status", 'is "template"; only a deployed manifest passes strict validation (use strict: false)');
    v.complete = false;
  } else if (manifest.status === "deployed") {
    v.complete = true;
  } else {
    v.err("status", `must be "template" or "deployed", got ${JSON.stringify(manifest.status)}`);
    v.complete = strict;
  }
  checkManifest(v, manifest, chosenSignerSet);
  if (v.errors.length) {
    throw new ManifestError(`invalid manifest "${manifest.environment ?? "?"}"`, v.errors);
  }
  return manifest;
}

const TOP_LEVEL_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "environment",
  "chainId",
  "status",
  "archived",
  "notes",
  "rpcEnv",
  "nativeCurrency",
  "blockTime",
  "multicall3",
  "explorer",
  "deploymentBlock",
  "sourceCommits",
  "deployer",
  "compromised",
  "safe",
  "bots",
  "assets",
  "contracts",
  "markets",
  "oracle",
  "roles",
  "observedRoles",
]);

class Validator {
  constructor() {
    this.errors = [];
    this.complete = true;
  }

  err(path, message) {
    this.errors.push(`${path} ${message}`);
  }

  /** null handling: in a template any value may be null; in a deployed manifest nothing may. */
  present(path, value) {
    if (value === null || value === undefined) {
      if (value === undefined) this.err(path, "is missing");
      else if (this.complete) this.err(path, "is null (a deployed manifest must set it)");
      return false;
    }
    return true;
  }

  object(path, value, allowedKeys) {
    if (!isPlainObject(value)) {
      this.err(path, value === undefined ? "is missing" : "must be an object");
      return false;
    }
    if (allowedKeys) {
      for (const key of Object.keys(value)) {
        if (!allowedKeys.includes(key)) this.err(`${path}.${key}`, "is not a known field");
      }
    }
    return true;
  }

  array(path, value) {
    if (!Array.isArray(value)) {
      this.err(path, value === undefined ? "is missing" : "must be an array");
      return false;
    }
    return true;
  }

  string(path, value, re, hint) {
    if (!this.present(path, value)) return null;
    if (typeof value !== "string" || (re && !re.test(value))) {
      this.err(path, `must be ${hint ?? "a string"}, got ${JSON.stringify(value)}`);
      return null;
    }
    return value;
  }

  integer(path, value, min, max) {
    if (!this.present(path, value)) return null;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      this.err(path, `must be an integer in [${min}, ${max}], got ${JSON.stringify(value)}`);
      return null;
    }
    return value;
  }

  bool(path, value) {
    if (!this.present(path, value)) return null;
    if (typeof value !== "boolean") {
      this.err(path, `must be a boolean, got ${JSON.stringify(value)}`);
      return null;
    }
    return value;
  }

  /**
   * Base-unit or price amount as a decimal string (JSON numbers lose precision above 2^53),
   * bounded by its on-chain type (`max`, default uint256).
   */
  uintString(path, value, max = UINT256_MAX, typeName = "uint256") {
    const s = this.string(path, value, /^(0|[1-9][0-9]{0,77})$/, "a decimal integer string");
    if (s === null) return null;
    if (BigInt(s) > max) {
      this.err(path, `is out of range for ${typeName} (max ${max})`);
      return null;
    }
    return s;
  }

  address(path, value) {
    if (!this.present(path, value)) return null;
    if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
      this.err(path, `must be a 0x-prefixed 20-byte address, got ${JSON.stringify(value)}`);
      return null;
    }
    if (value.toLowerCase() === ZERO_ADDRESS) {
      this.err(path, "is the zero address");
      return null;
    }
    const checksummed = toChecksumAddress(value);
    if (checksummed !== value) {
      this.err(path, `is not EIP-55 checksummed (expected ${checksummed})`);
      return null;
    }
    return value;
  }

  codehash(path, value) {
    const hash = this.string(path, value, /^0x[0-9a-f]{64}$/, "a lowercase 0x-prefixed 32-byte hash");
    if (hash === EMPTY_CODEHASH) this.err(path, "is the hash of empty code");
    if (hash !== null && /^0x0{64}$/.test(hash)) this.err(path, "is zero");
    return hash;
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UINT256_MAX = (1n << 256n) - 1n;
const PAIR_MAX_LIMIT = UINT256_MAX - 1n; // type(uint256).max means uncapped in LightlendPairCore
const UINT128_MAX = (1n << 128n) - 1n;
const INT256_MAX = (1n << 255n) - 1n;
const AAVE_MAX_CAP = 68_719_476_735; // ReserveConfiguration MAX_VALID_SUPPLY_CAP / MAX_VALID_BORROW_CAP (36 bits)
const AAVE_MAX_DEBT_CEILING = 1_099_511_627_775; // ReserveConfiguration MAX_VALID_DEBT_CEILING (40 bits, $0.01 units)
const AAVE_MIN_OPTIMAL_USAGE_RATIO = 100; // DefaultReserveInterestRateStrategyV2.MIN_OPTIMAL_POINT (1%)
const AAVE_MAX_OPTIMAL_USAGE_RATIO = 9_900; // DefaultReserveInterestRateStrategyV2.MAX_OPTIMAL_POINT (99%)
const AAVE_MAX_BORROW_RATE = 100_000; // DefaultReserveInterestRateStrategyV2.MAX_BORROW_RATE (1000%)
const ISOLATED_MAX_SEED = 10n ** 18n; // LightlendPairValidation.MAX_SEED_AMOUNT
const KEY_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const REPO_RE = /^[a-z0-9][a-z0-9-]*$/;
const SYMBOL_RE = /^[A-Z][A-Z0-9]{0,15}$/;

function checkManifest(v, m, signerSet) {
  for (const key of Object.keys(m)) {
    if (!TOP_LEVEL_KEYS.has(key)) v.err(key, "is not a known top-level field");
  }
  if (m.$schema !== undefined && typeof m.$schema !== "string") v.err("$schema", "must be a string");
  if (m.notes !== undefined && typeof m.notes !== "string") v.err("notes", "must be a string");
  if (m.schemaVersion !== SCHEMA_VERSION) v.err("schemaVersion", `must be ${SCHEMA_VERSION}, got ${JSON.stringify(m.schemaVersion)}`);
  if (typeof m.environment !== "string" || !REPO_RE.test(m.environment)) {
    v.err("environment", `must be a lowercase name, got ${JSON.stringify(m.environment)}`);
  }
  if (!Number.isSafeInteger(m.chainId) || m.chainId <= 0) v.err("chainId", `must be a positive integer, got ${JSON.stringify(m.chainId)}`);
  const known = typeof m.environment === "string" ? ENVIRONMENTS[m.environment] : undefined;
  if (!known) {
    v.err("environment", `${JSON.stringify(m.environment)} is not an active environment (known: ${Object.keys(ENVIRONMENTS).join(", ")})`);
  } else if (Number.isSafeInteger(m.chainId) && m.chainId !== known.chainId) {
    v.err("chainId", `is ${m.chainId}; environment "${m.environment}" is chain ${known.chainId}`);
  }

  // rpcEnv names an environment variable; the URL (which may carry an API key) never lives here.
  if (typeof m.rpcEnv !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(m.rpcEnv)) {
    v.err("rpcEnv", `must be an environment variable name (A-Z, 0-9, _), never a URL; got ${JSON.stringify(m.rpcEnv)}`);
  }
  if (v.object("nativeCurrency", m.nativeCurrency, ["name", "symbol", "decimals"])) {
    v.string("nativeCurrency.name", m.nativeCurrency.name, /^.{1,64}$/, "a non-empty string");
    v.string("nativeCurrency.symbol", m.nativeCurrency.symbol, SYMBOL_RE, "an upper-case symbol");
    v.integer("nativeCurrency.decimals", m.nativeCurrency.decimals, 0, 36);
  }
  v.integer("blockTime", m.blockTime, 1, 3_600_000); // milliseconds (viem chain `blockTime`)
  v.address("multicall3", m.multicall3);
  if (m.explorer === undefined) v.err("explorer", "is missing (use null when there is none)");
  else if (m.explorer !== null) checkHttpsUrl(v, "explorer", m.explorer);
  v.integer("deploymentBlock", m.deploymentBlock, 0, Number.MAX_SAFE_INTEGER);

  const repos = new Set();
  if (v.object("sourceCommits", m.sourceCommits)) {
    for (const [repo, commit] of Object.entries(m.sourceCommits)) {
      if (!REPO_RE.test(repo)) v.err(`sourceCommits.${repo}`, "repo name must be lowercase (a-z, 0-9, -)");
      repos.add(repo);
      v.string(`sourceCommits.${repo}`, commit, /^[0-9a-f]{40}$/, "a full 40-hex lowercase commit hash");
    }
  }

  v.address("deployer", m.deployer);
  if (v.array("compromised", m.compromised)) {
    m.compromised.forEach((a, i) => v.address(`compromised[${i}]`, a));
  }
  if (v.object("safe", m.safe, ["address", "owners", "threshold", "version", "singleton", "fallbackHandler"])) {
    v.address("safe.address", m.safe.address);
    if (v.array("safe.owners", m.safe.owners)) {
      if (m.safe.owners.length < 2) v.err("safe.owners", "needs at least 2 owners");
      m.safe.owners.forEach((a, i) => v.address(`safe.owners[${i}]`, a));
    }
    const max = Array.isArray(m.safe.owners) ? m.safe.owners.length : 2;
    v.integer("safe.threshold", m.safe.threshold, 2, Math.max(2, max));
    v.string("safe.version", m.safe.version, /^\d+\.\d+\.\d+$/, "a semver");
    v.address("safe.singleton", m.safe.singleton); // the Safe proxy's slot 0 (masterCopy)
    v.address("safe.fallbackHandler", m.safe.fallbackHandler); // keccak256("fallback_manager.handler.address")
  }
  if (v.object("bots", m.bots, ["keeper", "liquidator"])) {
    v.address("bots.keeper", m.bots.keeper);
    v.address("bots.liquidator", m.bots.liquidator);
  }

  const assetBySymbol = new Map();
  const assetSymbolOf = new Map(); // lowercase address -> symbol
  if (v.object("assets", m.assets)) {
    for (const [symbol, asset] of Object.entries(m.assets)) {
      const p = `assets.${symbol}`;
      if (!SYMBOL_RE.test(symbol)) v.err(p, "key must be an upper-case symbol");
      if (!v.object(p, asset, ["address", "decimals", "codehash"])) continue;
      const address = v.address(`${p}.address`, asset.address);
      v.integer(`${p}.decimals`, asset.decimals, 0, 18); // LighterDualOracle supports <= 18
      v.codehash(`${p}.codehash`, asset.codehash);
      assetBySymbol.set(symbol, address);
      if (address) {
        const prev = assetSymbolOf.get(lower(address));
        if (prev) v.err(`${p}.address`, `duplicates assets.${prev}.address (one token, one entry)`);
        else assetSymbolOf.set(lower(address), symbol);
      }
    }
  }
  const assetAddresses = new Set([...assetBySymbol.values()].filter(Boolean).map(lower));

  const contractAddresses = new Map(); // lowercase -> key
  const libraryRefs = [];
  const implementations = []; // [path, entry]
  if (v.object("contracts", m.contracts)) {
    for (const key of REQUIRED_CONTRACTS) {
      if (!(key in m.contracts)) v.err(`contracts.${key}`, "is missing (required contract)");
    }
    for (const [key, entry] of Object.entries(m.contracts)) {
      const p = `contracts.${key}`;
      if (!KEY_RE.test(key)) v.err(p, "key must be alphanumeric camelCase");
      if (!v.object(p, entry, ["address", "artifact", "codehash", "implementation", "libraries"])) continue;
      const address = v.address(`${p}.address`, entry.address);
      if (address) {
        const prev = contractAddresses.get(lower(address));
        if (prev) v.err(`${p}.address`, `duplicates contracts.${prev}.address`);
        else contractAddresses.set(lower(address), key);
      }
      checkArtifact(v, `${p}.artifact`, entry.artifact, repos);
      v.codehash(`${p}.codehash`, entry.codehash);
      checkLibraries(v, `${p}.libraries`, entry.libraries, libraryRefs);
      if (entry.implementation === undefined && isPlainObject(entry.artifact) && /Proxy$/.test(entry.artifact.contractName ?? "")) {
        v.err(p, `is a proxy (${entry.artifact.contractName}) and must have an implementation`);
      }
      if (entry.implementation !== undefined) {
        const ip = `${p}.implementation`;
        implementations.push([ip, entry.implementation]);
        if (v.object(ip, entry.implementation, ["address", "artifact", "codehash", "libraries"])) {
          const impl = v.address(`${ip}.address`, entry.implementation.address);
          if (impl && address && lower(impl) === lower(address)) v.err(`${ip}.address`, "equals the proxy address");
          checkArtifact(v, `${ip}.artifact`, entry.implementation.artifact, repos);
          v.codehash(`${ip}.codehash`, entry.implementation.codehash);
          checkLibraries(v, `${ip}.libraries`, entry.implementation.libraries, libraryRefs);
        }
      }
    }
  }
  const isContract = (address) => address !== null && contractAddresses.has(lower(address));
  const requireContract = (path, address) => {
    if (address && !isContract(address)) v.err(path, `${address} is not the address of an entry in contracts`);
  };
  const requireAsset = (path, address) => {
    if (address && !assetAddresses.has(lower(address))) v.err(path, `${address} is not the address of an entry in assets`);
  };
  for (const [path, address, name] of libraryRefs) {
    requireContract(path, address);
    const key = contractAddresses.get(lower(address));
    const artifactName = key ? m.contracts[key]?.artifact?.contractName : undefined;
    if (key && artifactName && artifactName !== name) v.err(path, `is contracts.${key} (${artifactName}), not a ${name} library`);
  }
  for (const address of assetAddresses) {
    if (contractAddresses.has(address)) v.err(`assets.${assetSymbolOf.get(address)}.address`, `is also contracts.${contractAddresses.get(address)}`);
  }
  // An implementation is its own contract: not an asset or a listed contract; proxies may share one
  // only if they agree on what it is.
  const implSeen = new Map();
  for (const [path, impl] of implementations) {
    if (!isPlainObject(impl) || typeof impl.address !== "string") continue;
    const k = lower(impl.address);
    if (contractAddresses.has(k)) v.err(`${path}.address`, `equals contracts.${contractAddresses.get(k)}`);
    if (assetAddresses.has(k)) v.err(`${path}.address`, "equals an asset address");
    const id = JSON.stringify([impl.artifact?.repo, impl.artifact?.path, impl.artifact?.contractName, impl.codehash]);
    const prev = implSeen.get(k);
    if (prev && prev.id !== id) v.err(`${path}`, `shares its address with ${prev.path} but not its artifact/codehash`);
    else if (!prev) implSeen.set(k, { path, id });
  }

  // ---- oracle
  // Each price source names the asset it prices, so "WETH is priced by the ETH market-0 source" is
  // explicit data that verify-deployment checks on-chain (wiring invariant).
  const pricedAssets = new Set(); // lowercase assets that have a source entry
  // Cross-section comparisons run only once the compared fields are filled (template mode).
  const allFilled = (list, fields) => Array.isArray(list) && list.every((x) => isPlainObject(x) && fields.every((f) => x[f] !== null && x[f] !== undefined));
  const sourcesFilled = isPlainObject(m.oracle) && allFilled(m.oracle.coreSources, ["asset"]) && allFilled(m.oracle.fixedSources, ["asset"]);
  const dualsFilled = isPlainObject(m.oracle) && allFilled(m.oracle.dualOracles, ["asset", "collateral"]);
  const sourceByAsset = new Map(); // lowercase asset -> lowercase source address
  const coreSourceMarketIds = [];
  const dualOracles = [];
  const checkSourceAsset = (p, s, a) => {
    const asset = v.address(`${p}.asset`, s.asset);
    requireAsset(`${p}.asset`, asset);
    if (!asset) return;
    if (pricedAssets.has(lower(asset))) v.err(`${p}.asset`, "already has a price source");
    pricedAssets.add(lower(asset));
    if (a) sourceByAsset.set(lower(asset), lower(a));
  };
  if (v.object("oracle", m.oracle, ["guard", "coreSources", "fixedSources", "dualOracles"])) {
    const o = m.oracle;
    if (v.object("oracle.guard", o.guard, ["maxRefAgeSec", "maxDeviationBps", "maxCorePriceAgeSec", "marketIds"])) {
      for (const [field, [min, max]] of Object.entries(GUARD_BOUNDS)) {
        v.integer(`oracle.guard.${field}`, o.guard[field], min, max);
      }
      if (v.array("oracle.guard.marketIds", o.guard.marketIds)) {
        if (o.guard.marketIds.length === 0) v.err("oracle.guard.marketIds", "must not be empty");
        o.guard.marketIds.forEach((id, i) => v.integer(`oracle.guard.marketIds[${i}]`, id, 0, 65535));
        if (new Set(o.guard.marketIds).size !== o.guard.marketIds.length) v.err("oracle.guard.marketIds", "has duplicates");
      }
    }
    if (v.array("oracle.coreSources", o.coreSources)) {
      o.coreSources.forEach((s, i) => {
        const p = `oracle.coreSources[${i}]`;
        if (!v.object(p, s, ["address", "asset", "marketId", "symbol", "priceDecimals", "minPrice8", "maxPrice8"])) return;
        const a = v.address(`${p}.address`, s.address);
        requireContract(`${p}.address`, a);
        checkSourceAsset(p, s, a);
        const id = v.integer(`${p}.marketId`, s.marketId, 0, 65535);
        if (id !== null) {
          if (coreSourceMarketIds.includes(id)) v.err(`${p}.marketId`, `duplicates market ${id}`);
          coreSourceMarketIds.push(id);
        }
        v.string(`${p}.symbol`, s.symbol, SYMBOL_RE, "an upper-case symbol");
        v.integer(`${p}.priceDecimals`, s.priceDecimals, 0, 18);
        // LighterCorePriceSource requires maxPrice <= type(int256).max.
        const min = v.uintString(`${p}.minPrice8`, s.minPrice8, INT256_MAX, "int256 (LighterCorePriceSource)");
        const max = v.uintString(`${p}.maxPrice8`, s.maxPrice8, INT256_MAX, "int256 (LighterCorePriceSource)");
        // LighterCorePriceSource: inclusive bounds, 0 < minPrice <= maxPrice.
        if (min !== null && max !== null && !(BigInt(min) > 0n && BigInt(min) <= BigInt(max))) {
          v.err(p, "needs 0 < minPrice8 <= maxPrice8");
        }
      });
    }
    if (v.array("oracle.fixedSources", o.fixedSources)) {
      o.fixedSources.forEach((s, i) => {
        const p = `oracle.fixedSources[${i}]`;
        if (!v.object(p, s, ["address", "asset", "symbol", "price8"])) return;
        const a = v.address(`${p}.address`, s.address);
        requireContract(`${p}.address`, a);
        checkSourceAsset(p, s, a);
        v.string(`${p}.symbol`, s.symbol, SYMBOL_RE, "an upper-case symbol");
        const price = v.uintString(`${p}.price8`, s.price8, INT256_MAX, "int256 (FixedPriceSource)");
        if (price === "0") v.err(`${p}.price8`, "must be positive");
      });
    }
    if (
      isPlainObject(o.guard) &&
      allFilled(o.coreSources, ["marketId"]) &&
      Array.isArray(o.guard.marketIds) &&
      o.guard.marketIds.every((id) => id !== null)
    ) {
      const guarded = [...o.guard.marketIds].sort((a, b) => a - b).join(",");
      const sources = [...coreSourceMarketIds].sort((a, b) => a - b).join(",");
      if (guarded !== sources) {
        v.err("oracle.guard.marketIds", `must equal the coreSources market ids [${sources}], got [${guarded}]`);
      }
    }
    if (v.array("oracle.dualOracles", o.dualOracles)) {
      o.dualOracles.forEach((d, i) => {
        const p = `oracle.dualOracles[${i}]`;
        if (!v.object(p, d, ["address", "asset", "collateral"])) return;
        const a = v.address(`${p}.address`, d.address);
        requireContract(`${p}.address`, a);
        const asset = v.address(`${p}.asset`, d.asset);
        const collateral = v.address(`${p}.collateral`, d.collateral);
        requireAsset(`${p}.asset`, asset);
        requireAsset(`${p}.collateral`, collateral);
        if (asset && collateral && lower(asset) === lower(collateral)) v.err(p, "asset equals collateral");
        for (const [field, token] of [["asset", asset], ["collateral", collateral]]) {
          if (token && sourcesFilled && !pricedAssets.has(lower(token))) v.err(`${p}.${field}`, "has no oracle price source");
        }
        if (asset && collateral) {
          if (dualOracles.some((x) => x.asset === lower(asset) && x.collateral === lower(collateral))) {
            v.err(p, "duplicates another dual oracle's asset/collateral order");
          }
          dualOracles.push({ asset: lower(asset), collateral: lower(collateral) });
        }
      });
    }
  }

  // ---- markets
  if (v.object("markets", m.markets, ["core", "isolated"])) {
    if (v.array("markets.core", m.markets.core)) {
      const seen = new Set();
      m.markets.core.forEach((mk, i) => {
        const p = `markets.core[${i}]`;
        if (
          !v.object(p, mk, [
            "symbol",
            "asset",
            "aToken",
            "variableDebtToken",
            "priceSource",
            "ltvBps",
            "liquidationThresholdBps",
            "liquidationBonusBps",
            "liquidationProtocolFeeBps",
            "reserveFactorBps",
            "debtCeiling",
            "supplyCap",
            "borrowCap",
            "active",
            "frozen",
            "paused",
            "borrowingEnabled",
            "flashLoanEnabled",
            "optimalUsageRatioBps",
            "baseVariableBorrowRateBps",
            "variableRateSlope1Bps",
            "variableRateSlope2Bps",
            "seedAmount",
            "params",
          ])
        ) {
          return;
        }
        const symbol = v.string(`${p}.symbol`, mk.symbol, SYMBOL_RE, "an upper-case symbol");
        if (symbol) {
          if (seen.has(symbol)) v.err(`${p}.symbol`, `duplicates market ${symbol}`);
          seen.add(symbol);
          if (!assetBySymbol.has(symbol)) v.err(`${p}.symbol`, `has no entry in assets`);
        }
        const asset = v.address(`${p}.asset`, mk.asset);
        const expectedAsset = symbol ? assetBySymbol.get(symbol) : null;
        if (asset && expectedAsset && lower(asset) !== lower(expectedAsset)) {
          v.err(`${p}.asset`, `must equal assets.${symbol}.address`);
        }
        requireContract(`${p}.aToken`, v.address(`${p}.aToken`, mk.aToken));
        requireContract(`${p}.variableDebtToken`, v.address(`${p}.variableDebtToken`, mk.variableDebtToken));
        const source = v.address(`${p}.priceSource`, mk.priceSource);
        if (source && asset) {
          const expected = sourceByAsset.get(lower(asset));
          if (!pricedAssets.has(lower(asset))) {
            if (sourcesFilled) v.err(`${p}.priceSource`, `no oracle.coreSources / oracle.fixedSources entry prices ${symbol ?? asset}`);
          }
          else if (expected && expected !== lower(source)) v.err(`${p}.priceSource`, `must be the oracle source whose asset is ${symbol ?? asset}`);
        }
        const ltv = v.integer(`${p}.ltvBps`, mk.ltvBps, 0, 10_000);
        const lt = v.integer(`${p}.liquidationThresholdBps`, mk.liquidationThresholdBps, 0, 10_000);
        const lb = v.integer(`${p}.liquidationBonusBps`, mk.liquidationBonusBps, 0, 10_000);
        v.integer(`${p}.liquidationProtocolFeeBps`, mk.liquidationProtocolFeeBps, 0, 10_000);
        v.integer(`${p}.reserveFactorBps`, mk.reserveFactorBps, 0, 10_000);
        v.integer(`${p}.debtCeiling`, mk.debtCeiling, 0, AAVE_MAX_DEBT_CEILING);
        checkAaveCollateralParams(v, p, ltv, lt, lb);
        v.integer(`${p}.supplyCap`, mk.supplyCap, 1, AAVE_MAX_CAP);
        v.integer(`${p}.borrowCap`, mk.borrowCap, 1, AAVE_MAX_CAP);
        v.bool(`${p}.active`, mk.active);
        v.bool(`${p}.frozen`, mk.frozen);
        v.bool(`${p}.paused`, mk.paused);
        v.bool(`${p}.borrowingEnabled`, mk.borrowingEnabled);
        v.bool(`${p}.flashLoanEnabled`, mk.flashLoanEnabled);
        v.integer(`${p}.optimalUsageRatioBps`, mk.optimalUsageRatioBps, AAVE_MIN_OPTIMAL_USAGE_RATIO, AAVE_MAX_OPTIMAL_USAGE_RATIO);
        const baseRate = v.integer(`${p}.baseVariableBorrowRateBps`, mk.baseVariableBorrowRateBps, 0, AAVE_MAX_BORROW_RATE);
        const slope1 = v.integer(`${p}.variableRateSlope1Bps`, mk.variableRateSlope1Bps, 0, AAVE_MAX_BORROW_RATE);
        const slope2 = v.integer(`${p}.variableRateSlope2Bps`, mk.variableRateSlope2Bps, 0, AAVE_MAX_BORROW_RATE);
        checkAaveRateParams(v, p, baseRate, slope1, slope2);
        // Aave keeps (scaled) balances in uint128.
        const seed = v.uintString(`${p}.seedAmount`, mk.seedAmount, UINT128_MAX, "uint128 (Aave scaled balance)");
        if (seed === "0") v.err(`${p}.seedAmount`, "must be positive (every reserve is seeded)");
        if (mk.params !== undefined && !isPlainObject(mk.params)) v.err(`${p}.params`, "must be an object");
      });
    }
    if (v.array("markets.isolated", m.markets.isolated)) {
      const seen = new Set();
      m.markets.isolated.forEach((mk, i) => {
        const p = `markets.isolated[${i}]`;
        if (
          !v.object(p, mk, [
            "name",
            "pair",
            "asset",
            "collateral",
            "maxLtvBps",
            "cleanLiquidationFeeBps",
            "protocolLiquidationFeeShareBps",
            "seedAmount",
            "depositLimit",
            "borrowLimit",
            "params",
          ])
        ) {
          return;
        }
        const name = v.string(`${p}.name`, mk.name, /^[A-Z0-9]+\/[A-Z0-9]+$/, '"ASSET/COLLATERAL"');
        if (name) {
          if (seen.has(name)) v.err(`${p}.name`, `duplicates ${name}`);
          seen.add(name);
        }
        requireContract(`${p}.pair`, v.address(`${p}.pair`, mk.pair));
        const asset = v.address(`${p}.asset`, mk.asset);
        const collateral = v.address(`${p}.collateral`, mk.collateral);
        requireAsset(`${p}.asset`, asset);
        requireAsset(`${p}.collateral`, collateral);
        if (name && asset && collateral) {
          const [assetSymbol, collateralSymbol] = name.split("/");
          if (lower(assetBySymbol.get(assetSymbol) ?? "") !== lower(asset)) v.err(`${p}.asset`, `must be assets.${assetSymbol}.address (name ${name})`);
          if (lower(assetBySymbol.get(collateralSymbol) ?? "") !== lower(collateral)) v.err(`${p}.collateral`, `must be assets.${collateralSymbol}.address (name ${name})`);
        }
        if (asset && collateral && dualsFilled && !dualOracles.some((d) => d.asset === lower(asset) && d.collateral === lower(collateral))) {
          v.err(p, "has no oracle.dualOracles entry with the same asset/collateral order");
        }
        const ltv = v.integer(`${p}.maxLtvBps`, mk.maxLtvBps, 0, 10_000);
        const clean = v.integer(`${p}.cleanLiquidationFeeBps`, mk.cleanLiquidationFeeBps, 0, 10_000);
        const share = v.integer(`${p}.protocolLiquidationFeeShareBps`, mk.protocolLiquidationFeeShareBps, 0, 10_000);
        checkPairParams(v, p, ltv, clean, share);
        const seed = v.uintString(`${p}.seedAmount`, mk.seedAmount, ISOLATED_MAX_SEED, "the pair seed (LightlendPairValidation.MAX_SEED_AMOUNT)");
        if (seed === "0") v.err(`${p}.seedAmount`, "must be positive (every pair is seeded)");
        const depositLimit = v.uintString(`${p}.depositLimit`, mk.depositLimit, PAIR_MAX_LIMIT, "a bounded pair depositLimit (< type(uint256).max)");
        if (depositLimit === "0") v.err(`${p}.depositLimit`, "must be positive (F4 bounded pair limit)");
        const borrowLimit = v.uintString(`${p}.borrowLimit`, mk.borrowLimit, PAIR_MAX_LIMIT, "a bounded pair borrowLimit (< type(uint256).max)");
        if (borrowLimit === "0") v.err(`${p}.borrowLimit`, "must be positive (F4 bounded pair limit)");
        if (depositLimit !== null && seed !== null && BigInt(depositLimit) < BigInt(seed)) {
          v.err(p, "needs depositLimit >= seedAmount");
        }
        if (mk.params !== undefined && !isPlainObject(mk.params)) v.err(`${p}.params`, "must be an object");
      });
    }
  }

  // ---- roles: expected holders (spec 3.4)
  const roleHolders = []; // [path, address]
  if (v.object("roles", m.roles, ["core", "guard", "isolated"])) {
    const r = m.roles;
    if (
      v.object("roles.core", r.core, [
        ...CORE_ROLE_FIELDS,
        "acl",
        "executorEmergencyEnabled",
        "executorDelaySec",
      ])
    ) {
      for (const f of CORE_ROLE_FIELDS) roleHolders.push([`roles.core.${f}`, v.address(`roles.core.${f}`, r.core[f])]);
      if (v.object("roles.core.acl", r.core.acl, ACL_ROLE_NAMES)) {
        for (const role of ACL_ROLE_NAMES) {
          const p = `roles.core.acl.${role}`;
          if (!v.array(p, r.core.acl[role])) continue;
          const members = r.core.acl[role].map((a, i) => v.address(`${p}[${i}]`, a));
          members.forEach((a, i) => roleHolders.push([`${p}[${i}]`, a]));
          const set = new Set(members.filter(Boolean).map(lower));
          if (set.size !== members.filter(Boolean).length) v.err(p, "has duplicate members");
        }
        if (Array.isArray(r.core.acl.DEFAULT_ADMIN) && r.core.acl.DEFAULT_ADMIN.length === 0) {
          v.err("roles.core.acl.DEFAULT_ADMIN", "must not be empty");
        }
      }
      v.bool("roles.core.executorEmergencyEnabled", r.core.executorEmergencyEnabled);
      v.integer("roles.core.executorDelaySec", r.core.executorDelaySec, 24 * 3600, 30 * 24 * 3600);
    }
    if (v.object("roles.guard", r.guard, GUARD_ROLE_FIELDS)) {
      const guardian = v.address("roles.guard.guardian", r.guard.guardian);
      roleHolders.push(["roles.guard.guardian", guardian]);
      const keeper = v.address("roles.guard.keeper", r.guard.keeper);
      // The keeper slot holds the keeper bot key and nothing else may (spec 3.4).
      if (keeper && isPlainObject(m.bots) && m.bots.keeper && lower(keeper) !== lower(m.bots.keeper)) {
        v.err("roles.guard.keeper", "must equal bots.keeper");
      }
    }
    if (v.object("roles.isolated", r.isolated, [...ISOLATED_ROLE_FIELDS, "timelockDelaySec"])) {
      for (const f of ISOLATED_ROLE_FIELDS) {
        roleHolders.push([`roles.isolated.${f}`, v.address(`roles.isolated.${f}`, r.isolated[f])]);
      }
      v.integer("roles.isolated.timelockDelaySec", r.isolated.timelockDelaySec, 2 * 24 * 3600, 30 * 24 * 3600);
    }
  }
  // Every role holder is the Safe or one of our contracts (Executor, Timelock). The guard keeper
  // (checked above) is the only slot an EOA may hold.
  const safeAddress = isPlainObject(m.safe) ? m.safe.address : null;
  // In a template this comparison waits until the Safe and every contract address are filled.
  const holdersComparable =
    typeof safeAddress === "string" &&
    isPlainObject(m.contracts) &&
    Object.values(m.contracts).every((e) => isPlainObject(e) && typeof e.address === "string");
  for (const [path, address] of roleHolders) {
    if (!address || !holdersComparable) continue;
    if (safeAddress && lower(address) === lower(safeAddress)) continue;
    if (isContract(address)) continue;
    v.err(path, `${address} must be the Safe or a contract in contracts (no EOA holds a role)`);
  }

  // ---- uniqueness: deployer, bot keys and Safe owners are distinct keys
  const keyHolders = [];
  keyHolders.push(["deployer", m.deployer]);
  if (isPlainObject(m.bots)) {
    keyHolders.push(["bots.keeper", m.bots.keeper], ["bots.liquidator", m.bots.liquidator]);
  }
  if (isPlainObject(m.safe) && Array.isArray(m.safe.owners)) {
    m.safe.owners.forEach((a, i) => keyHolders.push([`safe.owners[${i}]`, a]));
  }
  const firstSeen = new Map();
  for (const [path, address] of keyHolders) {
    if (typeof address !== "string") continue;
    const k = lower(address);
    if (firstSeen.has(k)) v.err(path, `reuses the key of ${firstSeen.get(k)} (deployer, bots and Safe owners must be distinct)`);
    else firstSeen.set(k, path);
    if (contractAddresses.has(k)) v.err(path, `equals contracts.${contractAddresses.get(k)}`);
    if (assetAddresses.has(k)) v.err(path, "equals an asset address");
    if (typeof safeAddress === "string" && k === lower(safeAddress)) v.err(path, "equals safe.address");
  }
  if (typeof safeAddress === "string" && contractAddresses.has(lower(safeAddress))) {
    v.err("safe.address", `equals contracts.${contractAddresses.get(lower(safeAddress))}`);
  }
  for (const field of ["singleton", "fallbackHandler"]) {
    const a = isPlainObject(m.safe) ? m.safe[field] : null;
    if (typeof a !== "string") continue;
    const k = lower(a);
    if (contractAddresses.has(k) || assetAddresses.has(k) || firstSeen.has(k) || (typeof safeAddress === "string" && k === lower(safeAddress))) {
      v.err(`safe.${field}`, "must be its own contract (not the Safe proxy, a key, an asset or a listed contract)");
    }
  }
  if (isPlainObject(m.safe) && typeof m.safe.singleton === "string" && typeof m.safe.fallbackHandler === "string" && lower(m.safe.singleton) === lower(m.safe.fallbackHandler)) {
    v.err("safe.fallbackHandler", "equals safe.singleton");
  }

  // ---- deployer: holds nothing after the deploy (spec 3.4)
  if (typeof m.deployer === "string") {
    const d = lower(m.deployer);
    for (const [path, value] of walkStrings(m)) {
      if (path === "deployer") continue;
      if (lower(value) === d) v.err(path, "is the deployer address; the deployer holds no role or slot");
    }
  }
  // ---- compromised: never anywhere except the compromised list itself
  if (Array.isArray(m.compromised)) {
    const bad = new Set(m.compromised.filter((a) => typeof a === "string").map(lower));
    for (const [path, value] of walkStrings(m)) {
      if (path.startsWith("compromised[")) continue;
      if (bad.has(lower(value))) v.err(path, "is a compromised address");
    }
  }

  // ---- different things live at different addresses (one contract, one job)
  const things = new Map();
  const distinct = (path, address) => {
    if (typeof address !== "string") return;
    const prev = things.get(lower(address));
    if (prev) v.err(path, `is the same address as ${prev}; each contract has one job`);
    else things.set(lower(address), path);
  };
  if (isPlainObject(m.contracts)) for (const key of REQUIRED_CONTRACTS) distinct(`contracts.${key}`, m.contracts[key]?.address);
  if (isPlainObject(m.markets)) {
    for (const [i, mk] of (Array.isArray(m.markets.core) ? m.markets.core : []).entries()) {
      distinct(`markets.core[${i}].aToken`, mk?.aToken);
      distinct(`markets.core[${i}].variableDebtToken`, mk?.variableDebtToken);
    }
    for (const [i, mk] of (Array.isArray(m.markets.isolated) ? m.markets.isolated : []).entries()) {
      distinct(`markets.isolated[${i}].pair`, mk?.pair);
    }
  }
  if (isPlainObject(m.oracle)) {
    for (const list of ["coreSources", "fixedSources", "dualOracles"]) {
      for (const [i, x] of (Array.isArray(m.oracle[list]) ? m.oracle[list] : []).entries()) distinct(`oracle.${list}[${i}].address`, x?.address);
    }
  }

  if (known?.layout) checkLayout(v, m, known.layout, signerSet);

  if (m.observedRoles !== undefined) {
    if (v.object("observedRoles", m.observedRoles)) {
      v.integer("observedRoles.block", m.observedRoles.block, 0, Number.MAX_SAFE_INTEGER);
      v.integer("observedRoles.blockTimestamp", m.observedRoles.blockTimestamp, 0, Number.MAX_SAFE_INTEGER);
      v.string("observedRoles.takenAt", m.observedRoles.takenAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/, "an ISO-8601 UTC time");
    }
  }
}

/**
 * Spec-fixed layout of one environment (see LIGHTER_DEVNET_LAYOUT). Null values (a template) are
 * skipped; every value that is set must match. One error per violated invariant.
 */
function checkLayout(v, m, layout, signerSet) {
  const eq = (a, b) => typeof a === "string" && typeof b === "string" && lower(a) === lower(b);
  const set = (x) => x !== null && x !== undefined;
  const obj = (x) => (isPlainObject(x) ? x : {});
  const arr = (x) => (Array.isArray(x) ? x : []);

  // Signer set (audit-fixes-v1 F6): enforced for every status === "deployed" manifest regardless
  // of `strict`, so `strict: false` never relaxes signer identity on a deployed manifest.
  const expectedSigners = layout.signerSets?.[signerSet];
  if (m.status === "deployed" && expectedSigners) {
    if (set(m.deployer) && !eq(m.deployer, expectedSigners.deployer)) {
      v.err("deployer", `must be ${expectedSigners.deployer} (signerSet "${signerSet}")`);
    }
    const bots = obj(m.bots);
    if (set(bots.keeper) && !eq(bots.keeper, expectedSigners.keeper)) {
      v.err("bots.keeper", `must be ${expectedSigners.keeper} (signerSet "${signerSet}")`);
    }
    if (set(bots.liquidator) && !eq(bots.liquidator, expectedSigners.liquidator)) {
      v.err("bots.liquidator", `must be ${expectedSigners.liquidator} (signerSet "${signerSet}")`);
    }
    const safeOwners = obj(m.safe).owners;
    if (Array.isArray(safeOwners) && safeOwners.every(set)) {
      const wantOwners = new Set(expectedSigners.safeOwners.map(lower));
      const haveOwners = new Set(safeOwners.map(lower));
      if (haveOwners.size !== wantOwners.size || [...haveOwners].some((a) => !wantOwners.has(a))) {
        v.err("safe.owners", `must equal the "${signerSet}" Safe owners [${expectedSigners.safeOwners.join(", ")}]`);
      }
    }
  }

  // compromised: the leaked Base Sepolia EOA is always listed.
  if (Array.isArray(m.compromised)) {
    const listed = m.compromised.some(
      (a) => typeof a === "string" && ADDRESS_RE.test(a) && keccak256Hex(hexToBytes(a.toLowerCase())) === layout.compromisedKeccak,
    );
    if (!listed) v.err("compromised", "must include the leaked Base Sepolia EOA 0xf9D4...E512 (full address: deployments/archive/base-sepolia.json)");
  }

  // assets (spec 3.1, 4): exactly WETH9 and USDC at the Lighter preinstall addresses.
  const assets = obj(m.assets);
  const wantSymbols = Object.keys(layout.assets).sort().join(", ");
  if (Object.keys(assets).sort().join(", ") !== wantSymbols) v.err("assets", `must be exactly ${wantSymbols} (spec 3.1)`);
  for (const [symbol, want] of Object.entries(layout.assets)) {
    const a = obj(assets[symbol]);
    if (set(a.address) && !eq(a.address, want.address)) v.err(`assets.${symbol}.address`, `must be ${want.address} (spec 3.1)`);
    if (set(a.decimals) && a.decimals !== want.decimals) v.err(`assets.${symbol}.decimals`, `must be ${want.decimals}`);
  }
  const symbolOf = (address) => Object.entries(layout.assets).find(([, w]) => eq(w.address, address))?.[0] ?? null;

  // markets (spec 3.1)
  const markets = obj(m.markets);
  const core = arr(markets.core).map((mk) => obj(mk).symbol);
  if (core.length !== layout.coreMarkets.length || [...core].sort().join(",") !== [...layout.coreMarkets].sort().join(",")) {
    v.err("markets.core", `must be exactly the ${layout.coreMarkets.join(" and ")} reserves (spec 3.1)`);
  }
  const isolated = arr(markets.isolated).map((mk) => obj(mk).name);
  if (isolated.length !== layout.isolatedMarkets.length || [...isolated].sort().join(",") !== [...layout.isolatedMarkets].sort().join(",")) {
    v.err("markets.isolated", `must be exactly the pairs ${layout.isolatedMarkets.join(" and ")} (asset/collateral, spec 3.1)`);
  }
  const oracle = obj(m.oracle);
  // Cardinality always; each entry's order only once both of its tokens are filled.
  const dualList = arr(oracle.dualOracles).map(obj);
  if (Array.isArray(oracle.dualOracles) && dualList.length !== layout.isolatedMarkets.length) {
    v.err("oracle.dualOracles", `must be exactly one dual oracle per pair (${layout.isolatedMarkets.length}), in the order ${layout.isolatedMarkets.join(" and ")} (asset/collateral)`);
  }
  dualList.forEach((d, i) => {
    if (!set(d.asset) || !set(d.collateral)) return;
    if (!layout.isolatedMarkets.includes(`${symbolOf(d.asset)}/${symbolOf(d.collateral)}`)) {
      v.err(`oracle.dualOracles[${i}]`, `must be one dual oracle per pair, in the order ${layout.isolatedMarkets.join(" or ")} (asset/collateral)`);
    }
  });

  // oracle (spec 3.2): WETH on the ETH perp market 0, USDC fixed at $1.00, market 0 guarded.
  const guardIds = arr(obj(oracle.guard).marketIds);
  if (Array.isArray(obj(oracle.guard).marketIds) && !guardIds.includes(layout.coreSource.marketId)) {
    v.err("oracle.guard.marketIds", `must include market ${layout.coreSource.marketId} (the ETH perp)`);
  }
  const coreSources = arr(oracle.coreSources).map(obj);
  const fixedSources = arr(oracle.fixedSources).map(obj);
  if (Array.isArray(oracle.coreSources) && coreSources.length !== 1) v.err("oracle.coreSources", `must be exactly one source: ${layout.coreSource.asset} on market ${layout.coreSource.marketId}`);
  if (Array.isArray(oracle.fixedSources) && fixedSources.length !== 1) v.err("oracle.fixedSources", `must be exactly one source: ${layout.fixedSource.asset} at ${layout.fixedSource.price8}`);
  for (const [i, src] of coreSources.entries()) {
    if ((set(src.asset) && symbolOf(src.asset) !== layout.coreSource.asset) || (set(src.marketId) && src.marketId !== layout.coreSource.marketId)) {
      v.err(`oracle.coreSources[${i}]`, `${layout.coreSource.asset} must be priced by the LighterCorePriceSource of market ${layout.coreSource.marketId} (the ETH perp)`);
    }
  }
  for (const [i, src] of fixedSources.entries()) {
    if ((set(src.asset) && symbolOf(src.asset) !== layout.fixedSource.asset) || (set(src.price8) && src.price8 !== layout.fixedSource.price8)) {
      v.err(`oracle.fixedSources[${i}]`, `${layout.fixedSource.asset} must be priced by a FixedPriceSource of ${layout.fixedSource.price8} ($1.00, 8 decimals)`);
    }
  }

  // proxies: Pool, PoolConfigurator and every aToken / variableDebtToken are EIP-1967 proxies.
  const contracts = obj(m.contracts);
  const keyOf = new Map(Object.entries(contracts).filter(([, e]) => typeof obj(e).address === "string").map(([k, e]) => [lower(e.address), k]));
  const proxyKeys = new Set(layout.proxies);
  for (const mk of arr(markets.core).map(obj)) {
    for (const f of ["aToken", "variableDebtToken"]) {
      if (typeof mk[f] === "string" && keyOf.has(lower(mk[f]))) proxyKeys.add(keyOf.get(lower(mk[f])));
    }
  }
  for (const key of proxyKeys) {
    if (isPlainObject(contracts[key]) && contracts[key].implementation === undefined) {
      v.err(`contracts.${key}`, "is an EIP-1967 proxy in this deployment and must have an implementation");
    }
  }

  // linked libraries: exactly the Aave logic libraries of each implementation
  for (const [key, refs] of Object.entries(layout.implementationLibraries)) {
    const impl = obj(obj(contracts[key]).implementation);
    if (!isPlainObject(obj(contracts[key]).implementation)) continue;
    const have = Object.keys(obj(impl.libraries)).sort().join(",");
    if (have !== [...refs].sort().join(",")) {
      v.err(`contracts.${key}.implementation.libraries`, `must be exactly ${refs.map((r) => r.split(":")[1]).join(", ")}`);
    }
  }

  // Safe 2/3 (spec 3.4)
  const safeEntry = obj(m.safe);
  if (set(safeEntry.version) && safeEntry.version !== layout.safe.version) v.err("safe.version", `must be ${layout.safe.version} (spec 3.5)`);
  if (set(safeEntry.singleton) && !layout.safe.singletons.some((a) => eq(a, safeEntry.singleton))) {
    v.err("safe.singleton", `must be a canonical Safe v${layout.safe.version} singleton (${layout.safe.singletons.join(" or ")})`);
  }
  if (set(safeEntry.fallbackHandler) && !eq(safeEntry.fallbackHandler, layout.safe.fallbackHandler)) {
    v.err("safe.fallbackHandler", `must be the v${layout.safe.version} CompatibilityFallbackHandler ${layout.safe.fallbackHandler}`);
  }
  if (Array.isArray(safeEntry.owners) && safeEntry.owners.length !== layout.safe.owners) {
    v.err("safe.owners", `must be exactly ${layout.safe.owners} owners`);
  }
  if (set(safeEntry.threshold) && safeEntry.threshold !== layout.safe.threshold) v.err("safe.threshold", `must be ${layout.safe.threshold} (Safe ${layout.safe.threshold}/${layout.safe.owners})`);

  // roles (spec 3.4)
  const safe = safeEntry.address ?? null;
  const executor = obj(contracts.executor).address ?? null;
  const timelock = obj(contracts.isolatedTimelock).address ?? null;
  const r = obj(m.roles);
  const rc = obj(r.core);
  const rg = obj(r.guard);
  const ri = obj(r.isolated);
  const holder = (path, value, expected, label) => {
    if (set(value) && set(expected) && !eq(value, expected)) v.err(path, `must be ${label} (spec 3.4)`);
  };
  holder("roles.core.poolAddressesProviderOwner", rc.poolAddressesProviderOwner, executor, "the Executor (contracts.executor)");
  holder("roles.core.aclAdmin", rc.aclAdmin, executor, "the Executor (contracts.executor)");
  holder("roles.core.executorOwner", rc.executorOwner, safe, "the Safe");
  holder("roles.core.treasury", rc.treasury, safe, "the Safe (treasury / fee receiver)");
  holder("roles.guard.guardian", rg.guardian, safe, "the Safe");
  for (const f of ["timelockAdmin", "deployerOwner", "deployerCircuitBreaker", "deployerComptroller", "registryOwner", "whitelistOwner", "pairOwner", "pairCircuitBreaker"]) {
    holder(`roles.isolated.${f}`, ri[f], safe, "the Safe");
  }
  holder("roles.isolated.deployerTimelock", ri.deployerTimelock, timelock, "the isolated Timelock (contracts.isolatedTimelock)");
  holder("roles.isolated.pairTimelock", ri.pairTimelock, timelock, "the isolated Timelock (contracts.isolatedTimelock)");
  if (set(rc.executorEmergencyEnabled) && rc.executorEmergencyEnabled !== false) {
    v.err("roles.core.executorEmergencyEnabled", "must be false (the Executor's emergency path stays disabled)");
  }
  if (set(rc.executorDelaySec) && rc.executorDelaySec !== layout.executorDelaySec) v.err("roles.core.executorDelaySec", `must be ${layout.executorDelaySec} (1 day)`);
  if (set(ri.timelockDelaySec) && ri.timelockDelaySec !== layout.timelockDelaySec) v.err("roles.isolated.timelockDelaySec", `must be ${layout.timelockDelaySec} (2 days)`);

  // ACL (spec 3.4, audit-fixes-v1 F1): exact member sets. Cardinality is checked even in a
  // template; members only once filled. POOL_ADMIN belongs solely to the timelocked Executor, and
  // ASSET_LISTING_ADMIN is empty so the Safe cannot list an unreviewed asset without the timelock.
  const acl = obj(rc.acl);
  const SAFE = { label: "the Safe", address: safe };
  const EXECUTOR = { label: "the Executor", address: executor };
  const aclLayout = {
    DEFAULT_ADMIN: [EXECUTOR],
    POOL_ADMIN: [EXECUTOR],
    RISK_ADMIN: [SAFE, EXECUTOR],
    EMERGENCY_ADMIN: [SAFE],
    ASSET_LISTING_ADMIN: [],
    FLASH_BORROWER: [],
    BRIDGE: [],
  };
  for (const [role, holders] of Object.entries(aclLayout)) {
    if (!Array.isArray(acl[role])) continue;
    const list = acl[role];
    const p = `roles.core.acl.${role}`;
    const labels = holders.length ? `{${holders.map((h) => h.label).join(", ")}}` : "{} (nobody)";
    if (list.length !== holders.length) {
      v.err(p, `must have exactly ${holders.length} member(s): ${labels} (spec 3.4)`);
    }
    for (const [i, a] of list.entries()) {
      if (!set(a) || holders.some((h) => !set(h.address))) continue;
      if (!holders.some((h) => eq(h.address, a))) v.err(`${p}[${i}]`, `must be one of ${labels} (spec 3.4)`);
    }
    if (list.every(set)) {
      for (const h of holders) {
        if (set(h.address) && !list.some((a) => eq(a, h.address))) v.err(p, `is missing ${h.label}: must be exactly ${labels} (spec 3.4)`);
      }
    }
  }
}

/**
 * Aave v3.2 PoolConfigurator.configureReserveAsCollateral, with the config engine's encoding of the
 * bonus (10000 + liquidationBonusBps) and PercentageMath.percentMul (half-up rounding).
 */
function checkAaveCollateralParams(v, p, ltv, lt, bonus) {
  if (ltv !== null && lt !== null && ltv > lt) v.err(p, "needs ltvBps <= liquidationThresholdBps (PoolConfigurator INVALID_RESERVE_PARAMS)");
  if (lt === null || bonus === null) return;
  if (lt === 0) {
    if (bonus !== 0) v.err(`${p}.liquidationBonusBps`, "must be 0 when liquidationThresholdBps is 0 (PoolConfigurator)");
    return;
  }
  const onChainBonus = 10_000 + bonus;
  if (!(onChainBonus > 10_000)) {
    v.err(`${p}.liquidationBonusBps`, "must be > 0: Aave requires a liquidation bonus above 100% (PoolConfigurator INVALID_RESERVE_PARAMS)");
  }
  const percentMul = Math.floor((lt * onChainBonus + 5_000) / 10_000);
  if (percentMul > 10_000) {
    v.err(p, `needs percentMul(liquidationThresholdBps, 10000 + liquidationBonusBps) <= 10000; got ${percentMul} (PoolConfigurator INVALID_RESERVE_PARAMS)`);
  }
}

/**
 * DefaultReserveInterestRateStrategyV2._setInterestRateParams (Aave v3.2, bps precision).
 */
function checkAaveRateParams(v, p, baseRate, slope1, slope2) {
  if (slope1 !== null && slope2 !== null && slope1 > slope2) {
    v.err(p, "needs variableRateSlope1Bps <= variableRateSlope2Bps (DefaultReserveInterestRateStrategyV2 SLOPE_2_MUST_BE_GTE_SLOPE_1)");
  }
  if (baseRate !== null && slope1 !== null && slope2 !== null && baseRate + slope1 + slope2 > AAVE_MAX_BORROW_RATE) {
    v.err(
      p,
      `needs baseVariableBorrowRateBps + variableRateSlope1Bps + variableRateSlope2Bps <= ${AAVE_MAX_BORROW_RATE} (DefaultReserveInterestRateStrategyV2 MAX_BORROW_RATE)`,
    );
  }
}

/**
 * LightlendPairCore constructor + LightlendPairValidation (S5a, 1e5 precision): the dirty fee is
 * derived as 90% of the clean fee, then validateLiquidationFees and validateLTV run. Manifest bps
 * are converted with x10.
 */
const LIQ_PRECISION = 100_000;
function checkPairParams(v, p, maxLtvBps, cleanBps, shareBps) {
  let feesBounded = false;
  let clean = null;
  if (cleanBps !== null && shareBps !== null) {
    clean = cleanBps * 10;
    const protocol = shareBps * 10;
    const dirty = Math.floor((clean * 90_000) / LIQ_PRECISION);
    let ok = true;
    const fail = (msg) => {
      ok = false;
      v.err(p, msg);
    };
    if (clean === 0 || dirty === 0) fail("needs cleanLiquidationFeeBps > 0 and a derived dirty fee (90% of clean) > 0 (InvalidLiquidationFee)");
    else if (clean > 50_000 || dirty > 50_000) fail("needs cleanLiquidationFeeBps <= 5000 (MAX_LIQUIDATION_FEE 50%, InvalidLiquidationFee)");
    else if (dirty > clean) fail("needs the derived dirty fee <= the clean fee (InvalidLiquidationFee)");
    else if (protocol >= LIQ_PRECISION) fail("needs protocolLiquidationFeeShareBps < 10000 (InvalidLiquidationFee)");
    else {
      const liquidatorShare = LIQ_PRECISION - protocol;
      if (clean * liquidatorShare < 2_000 * LIQ_PRECISION) fail("needs cleanLiquidationFeeBps x (1 - protocolLiquidationFeeShareBps) >= 2% (ISO-01 InsufficientLiquidatorBonus)");
      else if (dirty * liquidatorShare < 2_000 * LIQ_PRECISION) {
        fail("needs the derived dirty fee (90% of clean) x (1 - protocolLiquidationFeeShareBps) >= 2% (ISO-01 InsufficientLiquidatorBonus)");
      }
    }
    feesBounded = ok;
  }
  if (maxLtvBps !== null) {
    const maxLTV = maxLtvBps * 10;
    if (maxLTV === 0 || maxLTV > LIQ_PRECISION) v.err(p, "needs 0 < maxLtvBps <= 10000 (InvalidLTV)");
    else if (feesBounded && maxLTV * (LIQ_PRECISION + clean) > 98_000 * LIQ_PRECISION) {
      v.err(p, "needs maxLtvBps x (1 + cleanLiquidationFeeBps) <= 98% (ISO-05 MaxLTVTooHighForLiquidationFee)");
    }
  }
}

function checkArtifact(v, path, artifact, repos) {
  if (!v.object(path, artifact, ["repo", "path", "contractName"])) return;
  const repo = v.string(`${path}.repo`, artifact.repo, REPO_RE, "a repo name");
  if (repo && !repos.has(repo)) v.err(`${path}.repo`, `"${repo}" has no entry in sourceCommits`);
  const p = v.string(`${path}.path`, artifact.path, /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[\w@.\-/]+\.json$/, "a relative path to a .json artifact");
  if (p && p.includes("\\")) v.err(`${path}.path`, "must use forward slashes");
  v.string(`${path}.contractName`, artifact.contractName, /^[A-Za-z_$][A-Za-z0-9_$]*$/, "a Solidity contract name");
}

function checkLibraries(v, path, libraries, refs) {
  if (libraries === undefined) return;
  if (!v.object(path, libraries)) return;
  for (const [ref, address] of Object.entries(libraries)) {
    if (!/^[\w@.\-/]+\.sol:[A-Za-z_$][A-Za-z0-9_$]*$/.test(ref)) v.err(`${path}.${ref}`, 'key must be "<source path>.sol:<LibraryName>"');
    const a = v.address(`${path}.${ref}`, address);
    if (a) refs.push([`${path}.${ref}`, a, ref.split(":")[1]]);
  }
}

function checkHttpsUrl(v, path, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    v.err(path, `must be an https URL or null, got ${JSON.stringify(value)}`);
    return;
  }
  if (url.protocol !== "https:") v.err(path, "must use https");
  if (url.username || url.password || url.search) v.err(path, "must not carry credentials or a query string");
}

/** Yields [path, value] for every string in the manifest. */
function* walkStrings(value, path = "") {
  if (typeof value === "string") {
    yield [path, value];
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* walkStrings(value[i], `${path}[${i}]`);
  } else if (isPlainObject(value)) {
    for (const [k, child] of Object.entries(value)) yield* walkStrings(child, path ? `${path}.${k}` : k);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function lower(value) {
  return String(value).toLowerCase();
}

// ------------------------------------------------------------------------------------------------
// Addresses and Keccak-256 (dependency-free)
// ------------------------------------------------------------------------------------------------

/** EIP-55 checksum of a 20-byte hex address (any case). Throws on malformed input. */
export function toChecksumAddress(address) {
  if (typeof address !== "string" || !ADDRESS_RE.test(address)) {
    throw new ManifestError(`not an address: ${JSON.stringify(address)}`);
  }
  const hex = address.slice(2).toLowerCase();
  const hash = keccak256Hex(new TextEncoder().encode(hex)).slice(2);
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return out;
}

export function isChecksumAddress(address) {
  return typeof address === "string" && ADDRESS_RE.test(address) && toChecksumAddress(address) === address;
}

/** keccak256 of bytes (Uint8Array) or of a 0x-hex string's bytes; returns 0x-prefixed lowercase hex. */
export function keccak256Hex(input) {
  const bytes = typeof input === "string" ? hexToBytes(input) : input;
  return bytesToHex(keccak256(bytes));
}

export function hexToBytes(hex) {
  if (typeof hex !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new ManifestError(`not an even-length 0x hex string: ${String(hex).slice(0, 20)}`);
  }
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(2 + i * 2, 2), 16);
  return out;
}

export function bytesToHex(bytes) {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

// Keccak-f[1600] on 25 lanes held as (lo, hi) 32-bit halves.
const KECCAK_RC = new Uint32Array([
  0x00000001, 0x00000000, 0x00008082, 0x00000000, 0x0000808a, 0x80000000, 0x80008000, 0x80000000,
  0x0000808b, 0x00000000, 0x80000001, 0x00000000, 0x80008081, 0x80000000, 0x00008009, 0x80000000,
  0x0000008a, 0x00000000, 0x00000088, 0x00000000, 0x80008009, 0x00000000, 0x8000000a, 0x00000000,
  0x8000808b, 0x00000000, 0x0000008b, 0x80000000, 0x00008089, 0x80000000, 0x00008003, 0x80000000,
  0x00008002, 0x80000000, 0x00000080, 0x80000000, 0x0000800a, 0x00000000, 0x8000000a, 0x80000000,
  0x80008081, 0x80000000, 0x00008080, 0x80000000, 0x80000001, 0x00000000, 0x80008008, 0x80000000,
]);
// Rotation offsets r[x + 5y].
const KECCAK_ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

function keccakF(s) {
  const c = new Uint32Array(10);
  const b = new Uint32Array(50);
  for (let round = 0; round < 24; round++) {
    // theta
    for (let x = 0; x < 5; x++) {
      c[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
      c[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
    }
    for (let x = 0; x < 5; x++) {
      const nx = (x + 1) % 5;
      const px = (x + 4) % 5;
      const lo = c[2 * px] ^ ((c[2 * nx] << 1) | (c[2 * nx + 1] >>> 31));
      const hi = c[2 * px + 1] ^ ((c[2 * nx + 1] << 1) | (c[2 * nx] >>> 31));
      for (let y = 0; y < 25; y += 5) {
        s[2 * (x + y)] ^= lo;
        s[2 * (x + y) + 1] ^= hi;
      }
    }
    // rho + pi: B[y, 2x + 3y] = rot(A[x, y], r[x, y])
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        const n = KECCAK_ROT[i];
        const lo = s[2 * i];
        const hi = s[2 * i + 1];
        if (n === 0) {
          b[2 * j] = lo;
          b[2 * j + 1] = hi;
        } else if (n < 32) {
          b[2 * j] = (lo << n) | (hi >>> (32 - n));
          b[2 * j + 1] = (hi << n) | (lo >>> (32 - n));
        } else if (n === 32) {
          b[2 * j] = hi;
          b[2 * j + 1] = lo;
        } else {
          const k = n - 32;
          b[2 * j] = (hi << k) | (lo >>> (32 - k));
          b[2 * j + 1] = (lo << k) | (hi >>> (32 - k));
        }
      }
    }
    // chi
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const i = 2 * (x + y);
        const i1 = 2 * (((x + 1) % 5) + y);
        const i2 = 2 * (((x + 2) % 5) + y);
        s[i] = b[i] ^ (~b[i1] & b[i2]);
        s[i + 1] = b[i + 1] ^ (~b[i1 + 1] & b[i2 + 1]);
      }
    }
    // iota
    s[0] ^= KECCAK_RC[2 * round];
    s[1] ^= KECCAK_RC[2 * round + 1];
  }
}

/** Keccak-256 (the pre-NIST padding Ethereum uses). */
export function keccak256(bytes) {
  const rate = 136;
  const s = new Uint32Array(50);
  const padded = new Uint8Array(Math.floor(bytes.length / rate) * rate + rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 4; i++) {
      const p = off + i * 4;
      s[i] ^= padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24);
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const w = s[i];
    out[4 * i] = w & 0xff;
    out[4 * i + 1] = (w >>> 8) & 0xff;
    out[4 * i + 2] = (w >>> 16) & 0xff;
    out[4 * i + 3] = (w >>> 24) & 0xff;
  }
  return out;
}
