// Type declarations for the vendored loader `index.mjs` (kept byte-identical to
// lumina-monorepo/deployments/index.mjs). Only the exports and manifest fields the frontend uses
// are typed precisely; `lib/deployments.ts` normalizes the validated manifest into `LuminaDeployment`.

export declare const SCHEMA_VERSION: 1;

export type SignerSet = "live" | "harness";

/** Allowed signer sets for deployed manifests: "live" (default) or "harness" (Anvil tests only). */
export declare const SIGNER_SETS: readonly ["live", "harness"];

export declare const ENVIRONMENTS: Readonly<Record<string, Readonly<{ chainId: number; layout: unknown }>>>;

export declare const ARCHIVED_ENVIRONMENTS: Readonly<Record<string, Readonly<{ chainId: number; path: string }>>>;

export declare const REQUIRED_CONTRACTS: readonly string[];

export declare const ACL_ROLE_NAMES: readonly string[];

export declare const ZERO_ADDRESS: "0x0000000000000000000000000000000000000000";

export declare class ManifestError extends Error {
  constructor(message: string, errors?: string[]);
  errors: string[];
}

export interface ManifestCoreMarket {
  symbol: string;
  asset: string;
  aToken: string | null;
  variableDebtToken: string | null;
  priceSource: string | null;
  ltvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  liquidationProtocolFeeBps: number;
  reserveFactorBps: number;
  debtCeiling: number;
  supplyCap: number | null;
  borrowCap: number | null;
  active: boolean;
  frozen: boolean;
  paused: boolean;
  borrowingEnabled: boolean;
  flashLoanEnabled: boolean;
  optimalUsageRatioBps: number;
  baseVariableBorrowRateBps: number;
  variableRateSlope1Bps: number;
  variableRateSlope2Bps: number;
  seedAmount: string | null;
  params?: Record<string, unknown>;
}

export interface ManifestIsolatedMarket {
  name: string;
  pair: string | null;
  asset: string;
  collateral: string;
  maxLtvBps: number;
  cleanLiquidationFeeBps: number;
  protocolLiquidationFeeShareBps: number;
  seedAmount: string | null;
  depositLimit: string | null;
  borrowLimit: string | null;
  params?: Record<string, unknown>;
}

export interface ManifestV1 {
  schemaVersion: 1;
  environment: string;
  chainId: number;
  status: "template" | "deployed";
  rpcEnv: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockTime: number;
  multicall3: string;
  explorer: string | null;
  assets: Record<string, { address: string; decimals: number; codehash: string | null }>;
  contracts: Record<string, { address: string | null }>;
  markets: {
    core: ManifestCoreMarket[];
    isolated: ManifestIsolatedMarket[];
  };
  oracle: {
    guard: { maxRefAgeSec: number; maxDeviationBps: number; maxCorePriceAgeSec: number; marketIds: number[] };
    dualOracles: { address: string | null; asset: string; collateral: string }[];
  };
}

export interface LoadManifestOptions {
  env?: string;
  chainId?: number;
  path?: string | URL;
  /** An already-imported manifest (object or JSON text); no file access. */
  data?: unknown;
  /** Require a complete, deployed manifest (default true). */
  strict?: boolean;
  /** Allowed signer set for deployed manifests (default: `LUMINA_SIGNER_SET` or `"live"`). */
  signerSet?: SignerSet;
}

export interface ValidateManifestOptions {
  strict?: boolean;
  env?: string;
  chainId?: number;
  signerSet?: SignerSet;
}

/**
 * Resolve the signer set: explicit `option`, else `process.env.LUMINA_SIGNER_SET`, else `"live"`.
 * Throws `ManifestError` on unknown values.
 */
export declare function resolveSignerSet(option?: string): SignerSet;

/** Load and validate one environment's manifest. The result is deep-frozen. */
export declare function loadManifest(options?: LoadManifestOptions): unknown;

/** Validate a manifest object; throws ManifestError listing every problem. */
export declare function validateManifest(manifest: unknown, options?: ValidateManifestOptions): unknown;

export declare function toChecksumAddress(address: string): string;

export declare function isChecksumAddress(address: string): boolean;

export declare function keccak256Hex(input: string | Uint8Array): string;

export declare function hexToBytes(hex: string): Uint8Array;

export declare function bytesToHex(bytes: Uint8Array): string;

export declare function keccak256(bytes: Uint8Array): Uint8Array;
