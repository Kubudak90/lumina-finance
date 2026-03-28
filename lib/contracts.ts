import {
  POOL_ABI,
  AAVE_ORACLE_ABI,
  ATOKEN_ABI,
  VARIABLE_DEBT_TOKEN_ABI,
  DATA_PROVIDER_ABI,
  REWARDS_CONTROLLER_ABI,
  ERC20_ABI,
  INTEREST_RATE_STRATEGY_ABI,
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
  lit: checksumAddress("0xDf2B23A45B9a451c002c27F83e9e55da5efdc992"),
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
};

