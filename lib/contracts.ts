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
  ASSET_LISTING_PROXY_ABI,
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

  // --- Periphery contracts ---
  aggregator: checksumAddress("0xe2e08840c7a0b1B832E39FEe89e89C9653eD8320"),
  looping: checksumAddress("0xaB15f28b4e0821504c67D81E2B0B6468c2ee2429"),
  strategyManagerFactory: checksumAddress("0xF648581eEBC720C5aCbeB1b1036846664f018F50"),

  // --- Isolated lending ---
  isolatedOracle: checksumAddress("0xC743eA0Dc94bc5f6B27924e7C2FC714e05C9d1c5"),
  isolatedRegistry: checksumAddress("0x1247B132A6D2658DB8FC3e84EC522356C3D8F3bC"),
  isolatedDeployer: checksumAddress("0xeB4FFD4A0C3b8B066174d56F02C4C1cE6F787bFB"),
  isolatedPairLitUsdc: checksumAddress("0x837D5Bb10434Acd90008Be47201bce5b8aFaF7A5"),

  // --- Faucet (rate-limited public mint of USDC + LIT) ---
  faucet: checksumAddress("0x158b2a57C84C9C150b4D9CE5f8b78949145652d0"),

  // --- MockSwapper (testnet DEX adapter for Looping) ---
  swapper: checksumAddress("0x387Ec86135feAbC98F75729F75b9F3EA4e99c114"),

  // --- LIT price feed (CoinGecko-driven UpdatableAggregator) ---
  litOracleFeed: checksumAddress("0x1c2af9252306DD4Be3fF79980302C64a7BA46B1d"),

  // --- WETH price feed (CoinGecko-driven UpdatableAggregator) ---
  wethOracleFeed: checksumAddress("0x9966BCA6eD030256c2585D8823ecF035e296f49A"),

  // --- Aave V3 asset listing helpers ---
  configEngine: checksumAddress("0x84198a3f1646270d307b1a79a5b71e7f27966f8a"),
  assetListingProxy: checksumAddress("0x0A52d5e36A8E63f96c497D683422e0d609760Ec2"),
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
  ASSET_LISTING_PROXY_ABI,
};

