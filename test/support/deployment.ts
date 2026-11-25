import manifestJson from "../../deployments/lighter-devnet.json";
import { toChecksumAddress, type SignerSet } from "../../deployments/index.mjs";
import type { LuminaDeployment } from "../../lib/deployments";

export const fake = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;

export const POOL = fake(0x100);
export const ORACLE = fake(0x101);
export const DATA_PROVIDER = fake(0x102);
export const GUARD = fake(0x103);
export const STRATEGY = fake(0x104);
export const PAIR_USDC_WETH = fake(0x200);
export const PAIR_WETH_USDC = fake(0x201);
export const DUAL_USDC_WETH = fake(0x300);
export const DUAL_WETH_USDC = fake(0x301);

const SAFE_L2_V130_SINGLETON = "0xfb1bffC9d739B8D520DaF37dF666da4C687191EA";
const SAFE_V130_FALLBACK_HANDLER = "0x017062a1dE2FE6b99BE3d9d37841FeD19F573804";

/** Public Anvil test accounts matching the monorepo harness signer set (audit-fixes-v1 F6). */
const HARNESS_SIGNERS = {
  deployer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  safeOwners: [
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
    "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  ],
  keeper: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  liquidator: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
};

const FIXED_CONTRACT_ADDRESSES: Readonly<Record<string, `0x${string}`>> = {
  pool: POOL,
  aaveOracle: ORACLE,
  poolDataProvider: DATA_PROVIDER,
  priceGuard: GUARD,
  reserveInterestRateStrategy: STRATEGY,
  aTokenWETH: fake(0x400),
  aTokenUSDC: fake(0x401),
  variableDebtTokenWETH: fake(0x500),
  variableDebtTokenUSDC: fake(0x501),
  pairUsdcWeth: PAIR_USDC_WETH,
  pairWethUsdc: PAIR_WETH_USDC,
  dualOracleUsdcWeth: DUAL_USDC_WETH,
  dualOracleWethUsdc: DUAL_WETH_USDC,
};

interface MutableContractEntry {
  address: string | null;
  artifact: { repo: string; path: string; contractName: string };
  codehash: string | null;
  implementation?: {
    address: string | null;
    artifact: { repo: string; path: string; contractName: string };
    codehash: string | null;
    libraries?: Record<string, string | null>;
  };
}

/**
 * Build a complete, loader-valid `status: "deployed"` manifest derived from the vendored template,
 * carrying all F1 (ACL), F4 (pair deposit/borrow limits), and F6 (core reserve, signer set) fields.
 */
export function buildDeployedManifest(signerSet: SignerSet = "live"): Record<string, unknown> {
  const m = structuredClone(manifestJson) as Record<string, unknown>;
  let nextAddr = 0x1000;
  let nextHash = 1;
  const allocAddress = () => toChecksumAddress(fake(nextAddr++));
  const allocHash = () => `0x${(nextHash++).toString(16).padStart(64, "0")}`;

  m.status = "deployed";
  m.deploymentBlock = 1;
  m.sourceCommits = {
    "lumina-core": "1".repeat(40),
    "lumina-isolated": "2".repeat(40),
    "lumina-oracle": "3".repeat(40),
  };

  const safe = m.safe as {
    address: string | null;
    owners: string[];
    singleton: string | null;
    fallbackHandler: string | null;
  };
  const bots = m.bots as { keeper: string; liquidator: string };
  if (signerSet === "harness") {
    m.deployer = HARNESS_SIGNERS.deployer;
    safe.owners = [...HARNESS_SIGNERS.safeOwners];
    bots.keeper = HARNESS_SIGNERS.keeper;
    bots.liquidator = HARNESS_SIGNERS.liquidator;
  }
  const safeAddress = allocAddress();
  safe.address = safeAddress;
  safe.singleton = SAFE_L2_V130_SINGLETON;
  safe.fallbackHandler = SAFE_V130_FALLBACK_HANDLER;

  const assets = m.assets as Record<string, { address: string; decimals: number; codehash: string | null }>;
  for (const asset of Object.values(assets)) {
    asset.codehash = allocHash();
  }

  const contracts = m.contracts as Record<string, MutableContractEntry>;
  const addressByContractName = new Map<string, string>();
  for (const [key, entry] of Object.entries(contracts)) {
    const fixed = FIXED_CONTRACT_ADDRESSES[key];
    const address = fixed ? toChecksumAddress(fixed) : allocAddress();
    entry.address = address;
    entry.codehash = allocHash();
    addressByContractName.set(entry.artifact.contractName, address);
    if (entry.implementation) {
      entry.implementation.address = allocAddress();
      entry.implementation.codehash = allocHash();
    }
  }
  for (const entry of Object.values(contracts)) {
    if (entry.implementation?.libraries) {
      for (const ref of Object.keys(entry.implementation.libraries)) {
        const libName = ref.split(":")[1];
        const libAddr = addressByContractName.get(libName);
        if (!libAddr) throw new Error(`missing library contract for ${ref}`);
        entry.implementation.libraries[ref] = libAddr;
      }
    }
  }

  const oracle = m.oracle as {
    coreSources: { address: string | null; priceDecimals: number | null; minPrice8: string | null; maxPrice8: string | null }[];
    fixedSources: { address: string | null }[];
    dualOracles: { address: string | null }[];
  };
  oracle.coreSources[0].address = contracts.ethPriceSource.address;
  oracle.coreSources[0].priceDecimals = 8;
  oracle.coreSources[0].minPrice8 = "10000000000";
  oracle.coreSources[0].maxPrice8 = "10000000000000";
  oracle.fixedSources[0].address = contracts.usdcPriceSource.address;
  oracle.dualOracles[0].address = contracts.dualOracleUsdcWeth.address;
  oracle.dualOracles[1].address = contracts.dualOracleWethUsdc.address;

  const markets = m.markets as {
    core: {
      symbol: string;
      aToken: string | null;
      variableDebtToken: string | null;
      priceSource: string | null;
      supplyCap: number | null;
      borrowCap: number | null;
      seedAmount: string | null;
    }[];
    isolated: {
      name: string;
      pair: string | null;
      seedAmount: string | null;
      depositLimit: string | null;
      borrowLimit: string | null;
    }[];
  };
  const coreWeth = markets.core[0];
  coreWeth.aToken = contracts.aTokenWETH.address;
  coreWeth.variableDebtToken = contracts.variableDebtTokenWETH.address;
  coreWeth.priceSource = contracts.ethPriceSource.address;
  coreWeth.supplyCap = 100;
  coreWeth.borrowCap = 50;
  coreWeth.seedAmount = "10000000000000000";

  const coreUsdc = markets.core[1];
  coreUsdc.aToken = contracts.aTokenUSDC.address;
  coreUsdc.variableDebtToken = contracts.variableDebtTokenUSDC.address;
  coreUsdc.priceSource = contracts.usdcPriceSource.address;
  coreUsdc.supplyCap = 200_000;
  coreUsdc.borrowCap = 100_000;
  coreUsdc.seedAmount = "10000000";

  const isoUsdcWeth = markets.isolated[0];
  isoUsdcWeth.pair = contracts.pairUsdcWeth.address;
  isoUsdcWeth.seedAmount = "10000000";
  isoUsdcWeth.depositLimit = "150000000000";
  isoUsdcWeth.borrowLimit = "75000000000";

  const isoWethUsdc = markets.isolated[1];
  isoWethUsdc.pair = contracts.pairWethUsdc.address;
  isoWethUsdc.seedAmount = "10000000000000000";
  isoWethUsdc.depositLimit = "50000000000000000000";
  isoWethUsdc.borrowLimit = "25000000000000000000";

  const executor = contracts.executor.address!;
  const timelock = contracts.isolatedTimelock.address!;
  const roles = m.roles as {
    core: {
      poolAddressesProviderOwner: string | null;
      aclAdmin: string | null;
      acl: Record<string, (string | null)[]>;
      executorOwner: string | null;
      treasury: string | null;
    };
    guard: { guardian: string | null; keeper: string | null };
    isolated: Record<string, string | number | null>;
  };
  roles.core.poolAddressesProviderOwner = executor;
  roles.core.aclAdmin = executor;
  roles.core.acl = {
    DEFAULT_ADMIN: [executor],
    POOL_ADMIN: [executor],
    EMERGENCY_ADMIN: [safeAddress],
    RISK_ADMIN: [safeAddress, executor],
    FLASH_BORROWER: [],
    BRIDGE: [],
    ASSET_LISTING_ADMIN: [],
  };
  roles.core.executorOwner = safeAddress;
  roles.core.treasury = safeAddress;

  roles.guard.guardian = safeAddress;
  roles.guard.keeper = bots.keeper;

  roles.isolated.timelockAdmin = safeAddress;
  roles.isolated.deployerOwner = safeAddress;
  roles.isolated.deployerCircuitBreaker = safeAddress;
  roles.isolated.deployerComptroller = safeAddress;
  roles.isolated.deployerTimelock = timelock;
  roles.isolated.registryOwner = safeAddress;
  roles.isolated.whitelistOwner = safeAddress;
  roles.isolated.pairOwner = safeAddress;
  roles.isolated.pairTimelock = timelock;
  roles.isolated.pairCircuitBreaker = safeAddress;

  return m;
}

/** Complete deployed manifest (loader-valid under the "live" signer set) normalized for UI tests. */
export function filledDeployment(toDeployment: (m: never) => LuminaDeployment): LuminaDeployment {
  return toDeployment(buildDeployedManifest("live") as never);
}

export const USDC = manifestJson.assets.USDC.address as `0x${string}`;
export const WETH = manifestJson.assets.WETH.address as `0x${string}`;
