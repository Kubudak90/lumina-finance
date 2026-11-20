// Type declarations for the vendored loader `index.mjs` (kept byte-identical to the S6 copy in
// lumina-monorepo/deployments). Only the exports the frontend uses are typed precisely; the
// manifest itself is typed in `lib/deployments.ts`.

export declare const SCHEMA_VERSION: 1;

export declare const ENVIRONMENTS: Readonly<Record<string, Readonly<{ chainId: number; layout: unknown }>>>;

export declare const ARCHIVED_ENVIRONMENTS: Readonly<Record<string, Readonly<{ chainId: number; path: string }>>>;

export declare const REQUIRED_CONTRACTS: readonly string[];

export declare const ACL_ROLE_NAMES: readonly string[];

export declare const ZERO_ADDRESS: "0x0000000000000000000000000000000000000000";

export declare class ManifestError extends Error {
  constructor(message: string, errors?: string[]);
  errors: string[];
}

export interface LoadManifestOptions {
  env?: string;
  chainId?: number;
  path?: string | URL;
  /** An already-imported manifest (object or JSON text); no file access. */
  data?: unknown;
  /** Require a complete, deployed manifest (default true). */
  strict?: boolean;
}

/** Load and validate one environment's manifest. The result is deep-frozen. */
export declare function loadManifest(options?: LoadManifestOptions): unknown;

/** Validate a manifest object; throws ManifestError listing every problem. */
export declare function validateManifest(
  manifest: unknown,
  options?: { strict?: boolean; env?: string; chainId?: number },
): unknown;

export declare function toChecksumAddress(address: string): string;

export declare function isChecksumAddress(address: string): boolean;

export declare function keccak256Hex(input: string | Uint8Array): string;
