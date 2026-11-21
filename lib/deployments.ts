/**
 * Per-chain deployment registry. Every contract address the app uses comes from here, keyed by
 * chain id, and every manifest is validated by the vendored S6 loader (`deployments/index.mjs`).
 *
 * A manifest in `status: "template"` loads with `null` addresses: the UI then shows the market as
 * not deployed and disables every action instead of guessing an address.
 */
import { loadManifest } from "../deployments/index.mjs";
import lighterDevnetManifest from "../deployments/lighter-devnet.json";

export type Address = `0x${string}`;

/** Lumina on Lighter EVM devnet. The only chain the lending UI reads from or writes to. */
export const LUMINA_CHAIN_ID = 19529 as const;
export type LuminaChainId = typeof LUMINA_CHAIN_ID;

// ---------------------------------------------------------------------------------------------
// Manifest subset (schema: lumina-monorepo deployments/README.md, schemaVersion 1)
// ---------------------------------------------------------------------------------------------

interface ManifestContractEntry {
  address: string | null;
}

interface ManifestV1 {
  schemaVersion: 1;
  environment: string;
  chainId: number;
  status: "template" | "deployed";
  rpcEnv: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockTime: number;
  multicall3: string;
  explorer: string | null;
  assets: Record<string, { address: string; decimals: number }>;
  contracts: Record<string, ManifestContractEntry>;
  markets: {
    core: {
      symbol: string;
      asset: string;
      aToken: string | null;
      variableDebtToken: string | null;
      ltvBps: number;
      liquidationThresholdBps: number;
    }[];
    isolated: {
      name: string;
      pair: string | null;
      asset: string;
      collateral: string;
      maxLtvBps: number;
    }[];
  };
  oracle: {
    guard: { maxRefAgeSec: number; maxDeviationBps: number; maxCorePriceAgeSec: number; marketIds: number[] };
    dualOracles: { address: string | null; asset: string; collateral: string }[];
  };
}

// ---------------------------------------------------------------------------------------------
// Normalized deployment
// ---------------------------------------------------------------------------------------------

export interface CoreMarket {
  symbol: string;
  name: string;
  asset: Address;
  decimals: number;
  aToken: Address | null;
  variableDebtToken: Address | null;
}

export interface IsolatedMarket {
  /** "ASSET/COLLATERAL", as in the manifest. */
  name: string;
  pair: Address | null;
  asset: Address;
  collateral: Address;
  assetSymbol: string;
  collateralSymbol: string;
  assetDecimals: number;
  collateralDecimals: number;
  /** LighterDualOracle of this pair (same asset/collateral order). */
  dualOracle: Address | null;
}

export type ContractKey =
  | "poolAddressesProvider"
  | "pool"
  | "poolConfigurator"
  | "aaveOracle"
  | "poolDataProvider"
  | "aclManager"
  | "priceGuard"
  | "isolatedRegistry"
  | "isolatedDeployer"
  | "reserveInterestRateStrategy"
  /** Periphery recorded by the S4c deploy (absent from the template until then). Not read by the UI yet. */
  | "uiPoolDataProvider";

export interface LuminaDeployment {
  chainId: number;
  environment: string;
  status: "template" | "deployed";
  /** Name of the env var holding the RPC URL (never a URL). */
  rpcEnv: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockTime: number;
  multicall3: Address;
  explorer: string | null;
  contracts: Readonly<Record<ContractKey, Address | null>>;
  coreMarkets: readonly CoreMarket[];
  isolatedMarkets: readonly IsolatedMarket[];
  guard: Readonly<{ maxRefAgeSec: number; maxDeviationBps: number; maxCorePriceAgeSec: number }>;
}

const ASSET_NAMES: Record<string, string> = {
  WETH: "Wrapped Ether",
  USDC: "USD Coin",
};

const CONTRACT_KEYS: readonly ContractKey[] = [
  "poolAddressesProvider",
  "pool",
  "poolConfigurator",
  "aaveOracle",
  "poolDataProvider",
  "aclManager",
  "priceGuard",
  "isolatedRegistry",
  "isolatedDeployer",
  "reserveInterestRateStrategy",
  "uiPoolDataProvider",
];

const addr = (value: string | null | undefined): Address | null => (value ? (value as Address) : null);
const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Turn a validated manifest into the shape the UI uses. Throws on an internal inconsistency. */
export function toDeployment(manifest: ManifestV1): LuminaDeployment {
  const assetBySymbol = manifest.assets;
  const assetByAddress = (address: string) => {
    const entry = Object.entries(assetBySymbol).find(([, a]) => sameAddress(a.address, address));
    if (!entry) throw new Error(`manifest ${manifest.environment}: asset ${address} is not in "assets"`);
    return { symbol: entry[0], decimals: entry[1].decimals };
  };

  const contracts = Object.fromEntries(
    CONTRACT_KEYS.map((key) => [key, addr(manifest.contracts[key]?.address)]),
  ) as Record<ContractKey, Address | null>;

  const coreMarkets: CoreMarket[] = manifest.markets.core.map((m) => {
    const asset = assetByAddress(m.asset);
    return {
      symbol: m.symbol,
      name: ASSET_NAMES[m.symbol] ?? m.symbol,
      asset: m.asset as Address,
      decimals: asset.decimals,
      aToken: addr(m.aToken),
      variableDebtToken: addr(m.variableDebtToken),
    };
  });

  const isolatedMarkets: IsolatedMarket[] = manifest.markets.isolated.map((m) => {
    const asset = assetByAddress(m.asset);
    const collateral = assetByAddress(m.collateral);
    const oracle = manifest.oracle.dualOracles.find(
      (o) => sameAddress(o.asset, m.asset) && sameAddress(o.collateral, m.collateral),
    );
    return {
      name: m.name,
      pair: addr(m.pair),
      asset: m.asset as Address,
      collateral: m.collateral as Address,
      assetSymbol: asset.symbol,
      collateralSymbol: collateral.symbol,
      assetDecimals: asset.decimals,
      collateralDecimals: collateral.decimals,
      dualOracle: addr(oracle?.address),
    };
  });

  return Object.freeze({
    chainId: manifest.chainId,
    environment: manifest.environment,
    status: manifest.status,
    rpcEnv: manifest.rpcEnv,
    nativeCurrency: { ...manifest.nativeCurrency },
    blockTime: manifest.blockTime,
    multicall3: manifest.multicall3 as Address,
    explorer: manifest.explorer,
    contracts: Object.freeze(contracts),
    coreMarkets: Object.freeze(coreMarkets),
    isolatedMarkets: Object.freeze(isolatedMarkets),
    guard: Object.freeze({
      maxRefAgeSec: manifest.oracle.guard.maxRefAgeSec,
      maxDeviationBps: manifest.oracle.guard.maxDeviationBps,
      maxCorePriceAgeSec: manifest.oracle.guard.maxCorePriceAgeSec,
    }),
  });
}

/**
 * Validate one imported manifest with the S6 loader (no file access) and normalize it. A
 * "deployed" manifest must be complete (the loader enforces that even with strict: false); a
 * "template" may carry nulls.
 */
export function loadDeployment(chainId: number, data: unknown): LuminaDeployment {
  const manifest = loadManifest({ chainId, data, strict: false }) as ManifestV1;
  return toDeployment(manifest);
}

/** chain id → deployment. Add a chain by vendoring its manifest and registering it here. */
export const DEPLOYMENTS: Readonly<Record<number, LuminaDeployment>> = Object.freeze({
  [LUMINA_CHAIN_ID]: loadDeployment(LUMINA_CHAIN_ID, lighterDevnetManifest),
});

export function getDeployment(chainId: number): LuminaDeployment {
  const deployment = DEPLOYMENTS[chainId];
  if (!deployment) throw new Error(`no Lumina deployment for chain ${chainId}`);
  return deployment;
}

/** The lending deployment (chain 19529). */
export const LUMINA = getDeployment(LUMINA_CHAIN_ID);

/** Address of a deployed contract on `chainId`, or null while the manifest is a template. */
export function contractAddress(chainId: number, key: ContractKey): Address | null {
  return getDeployment(chainId).contracts[key];
}

/**
 * True once the manifest is `status: "deployed"`, which the loader only accepts when every address
 * is set. Until then the UI reads nothing it cannot address and enables no action.
 */
export function isDeployed(deployment: LuminaDeployment = LUMINA): boolean {
  return deployment.status === "deployed";
}

export function getCoreMarketByAsset(asset: string, deployment: LuminaDeployment = LUMINA): CoreMarket | undefined {
  return deployment.coreMarkets.find((m) => sameAddress(m.asset, asset));
}

export function getCoreMarketBySymbol(symbol: string, deployment: LuminaDeployment = LUMINA): CoreMarket | undefined {
  return deployment.coreMarkets.find((m) => m.symbol.toLowerCase() === symbol.toLowerCase());
}
