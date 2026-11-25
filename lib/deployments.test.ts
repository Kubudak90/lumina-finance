import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARCHIVED_ENVIRONMENTS,
  ENVIRONMENTS,
  ManifestError,
  SIGNER_SETS,
  loadManifest,
  resolveSignerSet,
} from "../deployments/index.mjs";
import manifestJson from "../deployments/lighter-devnet.json";
import { buildDeployedManifest } from "../test/support/deployment";
import {
  DEPLOYMENTS,
  LUMINA,
  LUMINA_CHAIN_ID,
  contractAddress,
  getDeployment,
  isDeployed,
  loadDeployment,
  toDeployment,
} from "./deployments";
import { RPC_URL_ENV, luminaChain, makeLuminaChain } from "./chains";

/** Template now; strict once the deploy scripts flip the manifest to "deployed". */
const strict = manifestJson.status === "deployed";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vendored manifest + loader (deployments/)", () => {
  it("the vendored loader validates the vendored manifest (data mode, as the app loads it)", () => {
    const m = loadManifest({ chainId: LUMINA_CHAIN_ID, data: manifestJson, strict, signerSet: "live" }) as {
      chainId: number;
      status: string;
    };
    expect(m.chainId).toBe(LUMINA_CHAIN_ID);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it("the vendored loader validates the vendored manifest (file mode, by env name)", () => {
    const m = loadManifest({ env: "lighter-devnet", strict, signerSet: "live" }) as { environment: string };
    expect(m.environment).toBe("lighter-devnet");
  });

  it("strict mode is reserved for a deployed manifest", () => {
    if (strict) {
      expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: manifestJson, strict: true, signerSet: "live" })).not.toThrow();
    } else {
      expect(manifestJson.status).toBe("template");
      expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: manifestJson, strict: true, signerSet: "live" })).toThrow(ManifestError);
    }
  });

  it("registers chain 19529 and refuses every archived chain", () => {
    expect(ENVIRONMENTS["lighter-devnet"].chainId).toBe(LUMINA_CHAIN_ID);
    for (const archived of Object.values(ARCHIVED_ENVIRONMENTS)) {
      expect(() => loadManifest({ chainId: archived.chainId, data: manifestJson, strict: false, signerSet: "live" })).toThrow(ManifestError);
    }
  });

  it("rejects a manifest whose addresses are tampered with", () => {
    const bad = structuredClone(manifestJson) as { multicall3: string };
    bad.multicall3 = bad.multicall3.toLowerCase().replace("0xca11", "0xca12");
    expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: bad, strict: false, signerSet: "live" })).toThrow(ManifestError);
  });

  it("exposes SIGNER_SETS and resolveSignerSet (F6)", () => {
    expect(SIGNER_SETS).toEqual(["live", "harness"]);
    expect(resolveSignerSet("live")).toBe("live");
    expect(resolveSignerSet("harness")).toBe("harness");
    expect(() => resolveSignerSet("unknown")).toThrow(ManifestError);
  });
});

describe("app entry point signer set enforcement (audit-fixes-v1 F6)", () => {
  it("loads the committed template with default settings", () => {
    vi.stubEnv("NEXT_PUBLIC_LUMINA_SIGNER_SET", "");
    const d = loadDeployment(LUMINA_CHAIN_ID, manifestJson);
    expect(d.chainId).toBe(LUMINA_CHAIN_ID);
    expect(d.status).toBe("template");
  });

  it("loads a deployed manifest signed by the live signers by default", () => {
    vi.stubEnv("NEXT_PUBLIC_LUMINA_SIGNER_SET", "");
    const live = buildDeployedManifest("live");
    const d = loadDeployment(LUMINA_CHAIN_ID, live);
    expect(d.status).toBe("deployed");
    expect(d.contracts.pool).not.toBeNull();
    expect(d.isolatedMarkets.every((m) => m.pair !== null)).toBe(true);
    expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: live, strict: true, signerSet: "live" })).not.toThrow();
  });

  it("rejects a deployed manifest signed by the harness accounts with default settings (including non-strict)", () => {
    vi.stubEnv("NEXT_PUBLIC_LUMINA_SIGNER_SET", "");
    vi.stubEnv("LUMINA_SIGNER_SET", "");
    const harness = buildDeployedManifest("harness");
    expect(() => loadDeployment(LUMINA_CHAIN_ID, harness)).toThrow(ManifestError);
    expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: harness, strict: false })).toThrow(ManifestError);
    expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: harness, strict: true })).toThrow(ManifestError);
  });

  it("never lets the loader fall back to LUMINA_SIGNER_SET on the server", () => {
    vi.stubEnv("NEXT_PUBLIC_LUMINA_SIGNER_SET", "");
    vi.stubEnv("LUMINA_SIGNER_SET", "harness");
    const harness = buildDeployedManifest("harness");
    const live = buildDeployedManifest("live");
    // Even though LUMINA_SIGNER_SET=harness is in the server environment, the app entry point
    // passes an explicit signerSet ("live") so the harness manifest is rejected and live loads.
    expect(() => loadDeployment(LUMINA_CHAIN_ID, harness)).toThrow(ManifestError);
    expect(loadDeployment(LUMINA_CHAIN_ID, live).status).toBe("deployed");

    // Likewise an invalid server LUMINA_SIGNER_SET never breaks loading the committed template.
    vi.stubEnv("LUMINA_SIGNER_SET", "bogus-server-value");
    expect(loadDeployment(LUMINA_CHAIN_ID, manifestJson).status).toBe("template");
  });

  it("loads a harness-signed deployed manifest when NEXT_PUBLIC_LUMINA_SIGNER_SET=harness and rejects live signers", () => {
    vi.stubEnv("NEXT_PUBLIC_LUMINA_SIGNER_SET", "harness");
    const harness = buildDeployedManifest("harness");
    const live = buildDeployedManifest("live");
    const d = loadDeployment(LUMINA_CHAIN_ID, harness);
    expect(d.status).toBe("deployed");
    expect(d.contracts.pool).not.toBeNull();
    expect(() => loadDeployment(LUMINA_CHAIN_ID, live)).toThrow(ManifestError);
  });

  it("treats any NEXT_PUBLIC_LUMINA_SIGNER_SET value other than exact 'harness' as 'live'", () => {
    const harness = buildDeployedManifest("harness");
    const live = buildDeployedManifest("live");
    for (const val of ["live", "HARNESS", " harness ", "other"]) {
      vi.stubEnv("NEXT_PUBLIC_LUMINA_SIGNER_SET", val);
      expect(() => loadDeployment(LUMINA_CHAIN_ID, harness)).toThrow(ManifestError);
      expect(loadDeployment(LUMINA_CHAIN_ID, live).status).toBe("deployed");
    }
  });

  it("enforces F1 ACL layout, F4 pair limits, and F6 core reserve fields on deployed manifests", () => {
    vi.stubEnv("NEXT_PUBLIC_LUMINA_SIGNER_SET", "");

    // F4: null pair depositLimit or borrowLimit is rejected.
    const missingLimit = buildDeployedManifest("live") as { markets: { isolated: { depositLimit: string | null }[] } };
    missingLimit.markets.isolated[0].depositLimit = null;
    expect(() => loadDeployment(LUMINA_CHAIN_ID, missingLimit)).toThrow(ManifestError);

    // F6: missing new core reserve field is rejected.
    const missingCoreField = buildDeployedManifest("live") as {
      markets: { core: Record<string, unknown>[] };
    };
    delete missingCoreField.markets.core[0].optimalUsageRatioBps;
    expect(() => loadDeployment(LUMINA_CHAIN_ID, missingCoreField)).toThrow(ManifestError);

    // F1: Safe holding POOL_ADMIN is rejected.
    const oldAcl = buildDeployedManifest("live") as {
      safe: { address: string };
      roles: { core: { acl: { POOL_ADMIN: string[] } } };
    };
    oldAcl.roles.core.acl.POOL_ADMIN.push(oldAcl.safe.address);
    expect(() => loadDeployment(LUMINA_CHAIN_ID, oldAcl)).toThrow(ManifestError);
  });
});

describe("deployment registry (addresses keyed by chain id)", () => {
  it("holds exactly the Lumina chain", () => {
    expect(Object.keys(DEPLOYMENTS)).toEqual([String(LUMINA_CHAIN_ID)]);
    expect(getDeployment(LUMINA_CHAIN_ID)).toBe(LUMINA);
    expect(() => getDeployment(1)).toThrow(/no Lumina deployment for chain 1/);
    expect(() => contractAddress(1, "pool")).toThrow();
  });

  it("takes every address from the manifest", () => {
    expect(LUMINA.multicall3).toBe(manifestJson.multicall3);
    expect(contractAddress(LUMINA_CHAIN_ID, "pool")).toBe(manifestJson.contracts.pool.address);
    expect(contractAddress(LUMINA_CHAIN_ID, "aaveOracle")).toBe(manifestJson.contracts.aaveOracle.address);
    expect(contractAddress(LUMINA_CHAIN_ID, "priceGuard")).toBe(manifestJson.contracts.priceGuard.address);
    expect(LUMINA.coreMarkets.map((m) => [m.symbol, m.asset])).toEqual(
      manifestJson.markets.core.map((m) => [m.symbol, m.asset]),
    );
    expect(LUMINA.isolatedMarkets.map((m) => [m.name, m.pair])).toEqual(
      manifestJson.markets.isolated.map((m) => [m.name, m.pair]),
    );
    expect(isDeployed()).toBe(manifestJson.status === "deployed");
  });

  it("resolves token metadata and pair oracles by address", () => {
    const usdcWeth = LUMINA.isolatedMarkets.find((m) => m.name === "USDC/WETH")!;
    expect(usdcWeth.assetSymbol).toBe("USDC");
    expect(usdcWeth.assetDecimals).toBe(6);
    expect(usdcWeth.collateralSymbol).toBe("WETH");
    expect(usdcWeth.collateralDecimals).toBe(18);
    const weth = LUMINA.coreMarkets.find((m) => m.symbol === "WETH")!;
    expect(weth.decimals).toBe(18);
  });

  it("maps a filled manifest's addresses per contract, market and pair oracle", () => {
    const filled = structuredClone(manifestJson) as typeof manifestJson & Record<string, unknown>;
    const fake = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
    (filled.contracts.pool as { address: string | null }).address = fake(1);
    (filled.markets.core[0] as { aToken: string | null }).aToken = fake(2);
    (filled.markets.isolated[1] as { pair: string | null }).pair = fake(3);
    (filled.oracle.dualOracles[1] as { address: string | null }).address = fake(4);
    const d = toDeployment(filled as never);
    expect(d.contracts.pool).toBe(fake(1));
    expect(d.coreMarkets[0].aToken).toBe(fake(2));
    const wethUsdc = d.isolatedMarkets.find((m) => m.name === "WETH/USDC")!;
    expect(wethUsdc.pair).toBe(fake(3));
    expect(wethUsdc.dualOracle).toBe(fake(4));
    expect(d.isolatedMarkets.find((m) => m.name === "USDC/WETH")!.dualOracle).toBeNull();
  });

  it("loads through the loader only (an invalid manifest never becomes a deployment)", () => {
    expect(() => loadDeployment(LUMINA_CHAIN_ID, { ...manifestJson, chainId: 1 })).toThrow(ManifestError);
  });
});

describe("chain 19529 (defineChain from the manifest)", () => {
  it("has native ETH, multicall3 and 1 s blocks from the manifest", () => {
    expect(luminaChain.id).toBe(LUMINA_CHAIN_ID);
    expect(luminaChain.nativeCurrency).toEqual(manifestJson.nativeCurrency);
    expect(luminaChain.contracts?.multicall3?.address).toBe(manifestJson.multicall3);
    expect(luminaChain.blockTime).toBe(1000);
    expect(luminaChain.blockTime).toBe(manifestJson.blockTime);
  });

  it("takes the explorer from the manifest (nullable)", () => {
    if (manifestJson.explorer === null) expect(luminaChain.blockExplorers).toBeUndefined();
    const withExplorer = makeLuminaChain({ ...LUMINA, explorer: "https://explorer.example" }, undefined);
    expect(withExplorer.blockExplorers?.default.url).toBe("https://explorer.example");
  });

  it("reads the RPC URL from the NEXT_PUBLIC_ twin of the manifest's rpcEnv", () => {
    expect(RPC_URL_ENV[LUMINA_CHAIN_ID]).toBe(`NEXT_PUBLIC_${manifestJson.rpcEnv}`);
    expect(RPC_URL_ENV[LUMINA_CHAIN_ID]).toBe("NEXT_PUBLIC_LIGHTER_DEVNET_RPC_URL");
    const chain = makeLuminaChain(LUMINA, "https://rpc.example/v1");
    expect(chain.rpcUrls.default.http).toEqual(["https://rpc.example/v1"]);
    expect(makeLuminaChain(LUMINA, undefined).rpcUrls.default.http).toEqual([]);
  });
});
