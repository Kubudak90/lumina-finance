import {
  POOL_ABI,
  AAVE_ORACLE_ABI,
  ATOKEN_ABI,
  VARIABLE_DEBT_TOKEN_ABI,
  DATA_PROVIDER_ABI,
  REWARDS_CONTROLLER_ABI,
  ERC20_ABI,
  INTEREST_RATE_STRATEGY_ABI,
  LOOPING_ABI,
  ISOLATED_REGISTRY_ABI,
  ISOLATED_PAIR_ABI,
  ISOLATED_DEPLOYER_ABI,
  ISOLATED_WHITELIST_ABI,
  ASSET_LISTING_PROXY_ABI,
  POOL_CONFIGURATOR_ABI,
  ACL_MANAGER_ABI,
} from "./abis";
import { checksumAddress } from "./format";
import baseSepolia from "../deployments/base-sepolia.json";

if (baseSepolia.chainId !== 84532) {
  throw new Error(`unexpected deployment chainId ${baseSepolia.chainId}`);
}

function checksumMap<T extends Record<string, string>>(input: T) {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, checksumAddress(value)])
  ) as { [K in keyof T]: `0x${string}` };
}

// Generated from deployments/base-sepolia.json — edit the manifest, not this object.
export const ADDRESSES = checksumMap(baseSepolia.contracts);

export const DEPLOYMENT = {
  environment: baseSepolia.environment,
  chainId: baseSepolia.chainId,
  explorer: baseSepolia.explorer,
  roles: checksumMap(baseSepolia.roles),
} as const;

// =============================================================================
// Re-export all ABIs for convenient single-file imports
// =============================================================================
export {
  POOL_ABI,
  AAVE_ORACLE_ABI,
  ATOKEN_ABI,
  VARIABLE_DEBT_TOKEN_ABI,
  DATA_PROVIDER_ABI,
  REWARDS_CONTROLLER_ABI,
  ERC20_ABI,
  INTEREST_RATE_STRATEGY_ABI,
  LOOPING_ABI,
  ISOLATED_REGISTRY_ABI,
  ISOLATED_PAIR_ABI,
  ISOLATED_DEPLOYER_ABI,
  ISOLATED_WHITELIST_ABI,
  ASSET_LISTING_PROXY_ABI,
  POOL_CONFIGURATOR_ABI,
  ACL_MANAGER_ABI,
};

