import { describe, expect, it } from "vitest";
import {
  ARCHIVED_ENVIRONMENTS,
  ENVIRONMENTS,
  ManifestError,
  loadManifest,
} from "../deployments/index.mjs";
import manifestJson from "../deployments/lighter-devnet.json";
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

describe("vendored manifest + loader (deployments/)", () => {
  it("the vendored loader validates the vendored manifest (data mode, as the app loads it)", () => {
    const m = loadManifest({ chainId: LUMINA_CHAIN_ID, data: manifestJson, strict }) as { chainId: number; status: string };
    expect(m.chainId).toBe(LUMINA_CHAIN_ID);
    expect(Object.isFrozen(m)).toBe(true);
  });

  it("the vendored loader validates the vendored manifest (file mode, by env name)", () => {
    const m = loadManifest({ env: "lighter-devnet", strict }) as { environment: string };
    expect(m.environment).toBe("lighter-devnet");
  });

  it("strict mode is reserved for a deployed manifest", () => {
    if (strict) {
      expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: manifestJson, strict: true })).not.toThrow();
    } else {
      expect(manifestJson.status).toBe("template");
      expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: manifestJson, strict: true })).toThrow(ManifestError);
    }
  });

  it("registers chain 19529 and refuses every archived chain", () => {
    expect(ENVIRONMENTS["lighter-devnet"].chainId).toBe(LUMINA_CHAIN_ID);
    for (const archived of Object.values(ARCHIVED_ENVIRONMENTS)) {
      expect(() => loadManifest({ chainId: archived.chainId, data: manifestJson, strict: false })).toThrow(ManifestError);
    }
  });

  it("rejects a manifest whose addresses are tampered with", () => {
    const bad = structuredClone(manifestJson) as { multicall3: string };
    bad.multicall3 = bad.multicall3.toLowerCase().replace("0xca11", "0xca12");
    expect(() => loadManifest({ chainId: LUMINA_CHAIN_ID, data: bad, strict: false })).toThrow(ManifestError);
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
