// =============================================================================
// Lumina Finance Frontend ABIs
// Extracted from compiled Aave V3 contract artifacts
// Only includes functions the frontend needs (minimal ABIs)
// =============================================================================

// -----------------------------------------------------------------------------
// Pool (Aave V3)
// -----------------------------------------------------------------------------
export const POOL_ABI = [
  // --- Mutative functions ---
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "referralCode", type: "uint16" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "repay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interestRateMode", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setUserUseReserveAsCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "useAsCollateral", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "liquidationCall",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralAsset", type: "address" },
      { name: "debtAsset", type: "address" },
      { name: "user", type: "address" },
      { name: "debtToCover", type: "uint256" },
      { name: "receiveAToken", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "flashLoanSimple",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "receiverAddress", type: "address" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "params", type: "bytes" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "setUserEMode",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "categoryId", type: "uint8" }],
    outputs: [],
  },
  // --- View functions ---
  {
    name: "getUserEMode",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getReservesList",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          {
            name: "configuration",
            type: "tuple",
            components: [{ name: "data", type: "uint256" }],
          },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
  {
    name: "getUserAccountData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
  },
  {
    name: "getUserConfiguration",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [{ name: "data", type: "uint256" }],
      },
    ],
  },
  {
    name: "getEModeCategoryData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint8" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "ltv", type: "uint16" },
          { name: "liquidationThreshold", type: "uint16" },
          { name: "liquidationBonus", type: "uint16" },
          { name: "priceSource", type: "address" },
          { name: "label", type: "string" },
        ],
      },
    ],
  },
] as const;

// -----------------------------------------------------------------------------
// AaveOracle
// -----------------------------------------------------------------------------
export const AAVE_ORACLE_ABI = [
  {
    name: "getAssetPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getAssetsPrices",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "assets", type: "address[]" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "getSourceOfAsset",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// -----------------------------------------------------------------------------
// AToken (Aave V3 interest-bearing token)
// -----------------------------------------------------------------------------
export const ATOKEN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "scaledBalanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "UNDERLYING_ASSET_ADDRESS",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // Standard ERC20 functions
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// -----------------------------------------------------------------------------
// VariableDebtToken (Aave V3)
// -----------------------------------------------------------------------------
export const VARIABLE_DEBT_TOKEN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "scaledBalanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "UNDERLYING_ASSET_ADDRESS",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "approveDelegation",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "delegatee", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "borrowAllowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "fromUser", type: "address" },
      { name: "toUser", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// -----------------------------------------------------------------------------
// LightlendPairRegistry (isolated lending registry)
// -----------------------------------------------------------------------------
export const ISOLATED_REGISTRY_ABI = [
  {
    name: "getAllPairAddresses",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "deployedPairsLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// -----------------------------------------------------------------------------
// LightlendPair (isolated lending pair)
// -----------------------------------------------------------------------------
export const ISOLATED_PAIR_ABI = [
  // --- Views ---
  { name: "asset", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "collateralContract", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "maxLTV", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  {
    name: "totalAsset",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "amount", type: "uint128" },
      { name: "shares", type: "uint128" },
    ],
  },
  {
    name: "totalBorrow",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "amount", type: "uint128" },
      { name: "shares", type: "uint128" },
    ],
  },
  {
    name: "getUserSnapshot",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_address", type: "address" }],
    outputs: [
      { name: "_userAssetShares", type: "uint256" },
      { name: "_userBorrowShares", type: "uint256" },
      { name: "_userCollateralBalance", type: "uint256" },
    ],
  },
  {
    name: "userCollateralBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "previewDeposit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_assets", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "previewRedeem",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_shares", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "previewWithdraw",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_amount", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "maxWithdraw",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "toAssetAmount",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_roundUp", type: "bool" },
      { name: "_previewInterest", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "toBorrowAmount",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_roundUp", type: "bool" },
      { name: "_previewInterest", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "toBorrowShares",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "_roundUp", type: "bool" },
      { name: "_previewInterest", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  // --- Mutative ---
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "_receiver", type: "address" },
      { name: "_owner", type: "address" },
    ],
    outputs: [{ name: "_sharesToBurn", type: "uint256" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_amount", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "_sharesReceived", type: "uint256" }],
  },
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_receiver", type: "address" },
      { name: "_owner", type: "address" },
    ],
    outputs: [{ name: "_amountToReturn", type: "uint256" }],
  },
  {
    name: "addCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_collateralAmount", type: "uint256" },
      { name: "_borrower", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "borrowAsset",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_borrowAmount", type: "uint256" },
      { name: "_collateralAmount", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "_shares", type: "uint256" }],
  },
  {
    name: "repayAsset",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_borrower", type: "address" },
    ],
    outputs: [{ name: "_amountToRepay", type: "uint256" }],
  },
  {
    name: "removeCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_collateralAmount", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "liquidate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_sharesToLiquidate", type: "uint128" },
      { name: "_deadline", type: "uint256" },
      { name: "_borrower", type: "address" },
    ],
    outputs: [{ name: "_collateralForLiquidator", type: "uint256" }],
  },
] as const;

// -----------------------------------------------------------------------------
// PoolConfigurator (admin ops: E-Mode categories, asset configs)
// -----------------------------------------------------------------------------
export const POOL_CONFIGURATOR_ABI = [
  {
    name: "setEModeCategory",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "categoryId", type: "uint8" },
      { name: "ltv", type: "uint16" },
      { name: "liquidationThreshold", type: "uint16" },
      { name: "liquidationBonus", type: "uint16" },
      { name: "label", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "setAssetCollateralInEMode",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "categoryId", type: "uint8" },
      { name: "allowed", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "setAssetBorrowableInEMode",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "categoryId", type: "uint8" },
      { name: "borrowable", type: "bool" },
    ],
    outputs: [],
  },
] as const;

// -----------------------------------------------------------------------------
// ACLManager
// -----------------------------------------------------------------------------
export const ACL_MANAGER_ABI = [
  { name: "isPoolAdmin", type: "function", stateMutability: "view", inputs: [{ name: "admin", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { name: "isRiskAdmin", type: "function", stateMutability: "view", inputs: [{ name: "admin", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { name: "isAssetListingAdmin", type: "function", stateMutability: "view", inputs: [{ name: "admin", type: "address" }], outputs: [{ name: "", type: "bool" }] },
] as const;

// -----------------------------------------------------------------------------
// LightlendPairDeployer (deploys new isolated pairs)
// -----------------------------------------------------------------------------
export const ISOLATED_DEPLOYER_ABI = [
  {
    name: "deploy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_configData", type: "bytes" }],
    outputs: [{ name: "_pairAddress", type: "address" }],
  },
  {
    name: "amountToSeed",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "lightlendWhitelistAddress",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "deployedPairsLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// -----------------------------------------------------------------------------
// LightlendWhitelist (whitelist for isolated pair deployers)
// -----------------------------------------------------------------------------
export const ISOLATED_WHITELIST_ABI = [
  {
    name: "lightlendDeployerWhitelist",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// -----------------------------------------------------------------------------
// AssetListingProxy (forwards Aave V3 ConfigEngine.listAssets via delegatecall)
// -----------------------------------------------------------------------------
export const ASSET_LISTING_PROXY_ABI = [
  {
    name: "listAssets",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "context",
        type: "tuple",
        components: [
          { name: "networkName", type: "string" },
          { name: "networkAbbreviation", type: "string" },
        ],
      },
      {
        name: "listings",
        type: "tuple[]",
        components: [
          { name: "asset", type: "address" },
          { name: "assetSymbol", type: "string" },
          { name: "priceFeed", type: "address" },
          {
            name: "rateStrategyParams",
            type: "tuple",
            components: [
              { name: "optimalUsageRatio", type: "uint256" },
              { name: "baseVariableBorrowRate", type: "uint256" },
              { name: "variableRateSlope1", type: "uint256" },
              { name: "variableRateSlope2", type: "uint256" },
            ],
          },
          { name: "enabledToBorrow", type: "uint256" },
          { name: "borrowableInIsolation", type: "uint256" },
          { name: "withSiloedBorrowing", type: "uint256" },
          { name: "flashloanable", type: "uint256" },
          { name: "ltv", type: "uint256" },
          { name: "liqThreshold", type: "uint256" },
          { name: "liqBonus", type: "uint256" },
          { name: "reserveFactor", type: "uint256" },
          { name: "supplyCap", type: "uint256" },
          { name: "borrowCap", type: "uint256" },
          { name: "debtCeiling", type: "uint256" },
          { name: "liqProtocolFee", type: "uint256" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// -----------------------------------------------------------------------------
// Looping (Lumina leveraged-position contract)
// -----------------------------------------------------------------------------
export const LOOPING_ABI = [
  {
    name: "openPosition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_pool", type: "address" },
      { name: "_swapper", type: "address" },
      { name: "_debtAsset", type: "address" },
      { name: "_yieldAsset", type: "address" },
      { name: "_initialAmount", type: "uint256" },
      { name: "_flashloanAmount", type: "uint256" },
      { name: "_minAmountOut", type: "uint256" },
      { name: "_path", type: "address[]" },
      { name: "_startWithYield", type: "bool" },
      { name: "_minInitialAmountOut", type: "uint256" },
      { name: "_deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "closePosition",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_pool", type: "address" },
      { name: "_swapper", type: "address" },
      { name: "_debtAsset", type: "address" },
      { name: "_yieldAsset", type: "address" },
      { name: "_flashloanAmount", type: "uint256" },
      { name: "_minAmountOut", type: "uint256" },
      { name: "_path", type: "address[]" },
      { name: "_withdrawAmount", type: "uint256" },
      { name: "_deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "pools",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "swappers",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "referralAddress",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// -----------------------------------------------------------------------------
// AaveProtocolDataProvider
// -----------------------------------------------------------------------------
export const DATA_PROVIDER_ABI = [
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "unbacked", type: "uint256" },
      { name: "accruedToTreasuryScaled", type: "uint256" },
      { name: "totalAToken", type: "uint256" },
      { name: "totalStableDebt", type: "uint256" },
      { name: "totalVariableDebt", type: "uint256" },
      { name: "liquidityRate", type: "uint256" },
      { name: "variableBorrowRate", type: "uint256" },
      { name: "stableBorrowRate", type: "uint256" },
      { name: "averageStableBorrowRate", type: "uint256" },
      { name: "liquidityIndex", type: "uint256" },
      { name: "variableBorrowIndex", type: "uint256" },
      { name: "lastUpdateTimestamp", type: "uint40" },
    ],
  },
  {
    name: "getReserveConfigurationData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "decimals", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "liquidationThreshold", type: "uint256" },
      { name: "liquidationBonus", type: "uint256" },
      { name: "reserveFactor", type: "uint256" },
      { name: "usageAsCollateralEnabled", type: "bool" },
      { name: "borrowingEnabled", type: "bool" },
      { name: "stableBorrowRateEnabled", type: "bool" },
      { name: "isActive", type: "bool" },
      { name: "isFrozen", type: "bool" },
    ],
  },
  {
    name: "getUserReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "asset", type: "address" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "currentATokenBalance", type: "uint256" },
      { name: "currentStableDebt", type: "uint256" },
      { name: "currentVariableDebt", type: "uint256" },
      { name: "principalStableDebt", type: "uint256" },
      { name: "scaledVariableDebt", type: "uint256" },
      { name: "stableBorrowRate", type: "uint256" },
      { name: "liquidityRate", type: "uint256" },
      { name: "stableRateLastUpdated", type: "uint40" },
      { name: "usageAsCollateralEnabled", type: "bool" },
    ],
  },
  {
    name: "getReserveTokensAddresses",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "aTokenAddress", type: "address" },
      { name: "stableDebtTokenAddress", type: "address" },
      { name: "variableDebtTokenAddress", type: "address" },
    ],
  },
  {
    name: "getAllReservesTokens",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "symbol", type: "string" },
          { name: "tokenAddress", type: "address" },
        ],
      },
    ],
  },
  {
    name: "getAllATokens",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "symbol", type: "string" },
          { name: "tokenAddress", type: "address" },
        ],
      },
    ],
  },
] as const;

// -----------------------------------------------------------------------------
// RewardsController
// -----------------------------------------------------------------------------
export const REWARDS_CONTROLLER_ABI = [
  {
    name: "claimAllRewards",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "address[]" },
      { name: "to", type: "address" },
    ],
    outputs: [
      { name: "rewardsList", type: "address[]" },
      { name: "claimedAmounts", type: "uint256[]" },
    ],
  },
  {
    name: "getUserRewards",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "assets", type: "address[]" },
      { name: "user", type: "address" },
      { name: "reward", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getRewardsList",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "getAllUserRewards",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "assets", type: "address[]" },
      { name: "user", type: "address" },
    ],
    outputs: [
      { name: "rewardsList", type: "address[]" },
      { name: "unclaimedAmounts", type: "uint256[]" },
    ],
  },
] as const;

// -----------------------------------------------------------------------------
// DefaultReserveInterestRateStrategy (Aave V3)
// -----------------------------------------------------------------------------
export const INTEREST_RATE_STRATEGY_ABI = [
  {
    name: "getBaseVariableBorrowRate",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getVariableRateSlope1",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getVariableRateSlope2",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "OPTIMAL_USAGE_RATIO",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// -----------------------------------------------------------------------------
// Standard ERC20
// -----------------------------------------------------------------------------
export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;
