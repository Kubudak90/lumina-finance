import {
  POOL_ABI,
  AAVE_ORACLE_ABI,
  ATOKEN_ABI,
  VARIABLE_DEBT_TOKEN_ABI,
  DATA_PROVIDER_ABI,
  REWARDS_CONTROLLER_ABI,
  ERC20_ABI,
} from "./abis";
import { checksumAddress } from "./format";

// =============================================================================
// Deployed contract addresses on Base Sepolia (chain ID 84532)
// Addresses are checksum-validated at module load time to catch typos early.
// =============================================================================
export const ADDRESSES = {
  // --- Core Aave V3 protocol ---
  pool: checksumAddress("0xCe390a9B81841c077bC4541f16D53d2a01bdEb39"),
  poolConfigurator: checksumAddress("0xE4F797d68111F0635E5423EFc7035688CF78BB0c"),
  oracle: checksumAddress("0x0103951a20eD2bd84Bd79FE3719553A358893911"),
  dataProvider: checksumAddress("0x7949865603B716A442f65249D428D03F10950825"),
  rewardsController: checksumAddress("0x0903A0e176375F11C86E74e316E1B806DDD49A2b"),

  // --- Underlying token addresses ---
  usdc: checksumAddress("0x57d6EB79ea08D10d7e03865cb1820f01F82255c4"),
  weth: checksumAddress("0xDf2B23A45B9a451c002c27F83e9e55da5efdc992"),
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
};

// =============================================================================
// Backward-compatible aliases (old system -> new Aave V3)
// These keep existing frontend imports working during migration.
// TODO: Remove these once all components are updated to use the new ABIs
// =============================================================================

/** @deprecated Use POOL_ABI instead */
export const LENDING_POOL_ABI = POOL_ABI;

/** @deprecated Use VARIABLE_DEBT_TOKEN_ABI instead */
export const DEBT_TOKEN_ABI = VARIABLE_DEBT_TOKEN_ABI;

/** @deprecated Use ATOKEN_ABI instead */
export const LTOKEN_ABI = ATOKEN_ABI;

/** @deprecated No longer needed in Aave V3 architecture */
export const ADAPTER_ABI = [
  {
    name: "deposits",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** @deprecated No longer needed - rates are handled by Aave V3 pool internally */
export const INTEREST_RATE_MODEL_ABI = [
  {
    name: "baseRate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "slope1",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "slope2",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "optimalUtilization",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
