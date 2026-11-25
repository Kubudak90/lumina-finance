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
  // --- View functions ---
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
    name: "getVirtualUnderlyingBalance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint128" }],
  },
  {
    name: "getUserEMode",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
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
] as const;

// -----------------------------------------------------------------------------
// LightlendPair (isolated lending pair)
// -----------------------------------------------------------------------------
export const ISOLATED_PAIR_ABI = [
  // --- Views ---
  { name: "asset", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "collateralContract", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "maxLTV", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "cleanLiquidationFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "dirtyLiquidationFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "protocolLiquidationFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
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
  {
    name: "maxRedeem",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_owner", type: "address" }],
    outputs: [{ name: "_maxShares", type: "uint256" }],
  },
  {
    name: "getPairAccounting",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_totalAssetAmount", type: "uint128" },
      { name: "_totalAssetShares", type: "uint128" },
      { name: "_totalBorrowAmount", type: "uint128" },
      { name: "_totalBorrowShares", type: "uint128" },
      { name: "_totalCollateral", type: "uint256" },
    ],
  },
  {
    name: "borrowLimit",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // Interest accrued up to this block, without writing it: the live rate and the previewed totals.
    name: "previewAddInterest",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_interestEarned", type: "uint256" },
      { name: "_feesAmount", type: "uint256" },
      { name: "_feesShare", type: "uint256" },
      {
        name: "_newCurrentRateInfo",
        type: "tuple",
        components: [
          { name: "lastBlock", type: "uint32" },
          { name: "feeToProtocolRate", type: "uint32" },
          { name: "lastTimestamp", type: "uint64" },
          { name: "ratePerSec", type: "uint64" },
          { name: "fullUtilizationRate", type: "uint64" },
        ],
      },
      {
        name: "_totalAsset",
        type: "tuple",
        components: [
          { name: "amount", type: "uint128" },
          { name: "shares", type: "uint128" },
        ],
      },
      {
        name: "_totalBorrow",
        type: "tuple",
        components: [
          { name: "amount", type: "uint128" },
          { name: "shares", type: "uint128" },
        ],
      },
    ],
  },
  { name: "isInterestPaused", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  // --- Custom errors (lumina-isolated LightlendPairConstants.sol + LightlendPairAccessControlErrors.sol) ---
  // Every error both files declare, so a revert from any pair entry point decodes by name.
  {
    name: "Insolvent",
    type: "error",
    inputs: [
      { name: "_borrow", type: "uint256" },
      { name: "_collateral", type: "uint256" },
      { name: "_exchangeRate", type: "uint256" },
    ],
  },
  { name: "BorrowerSolvent", type: "error", inputs: [] },
  {
    name: "InsufficientAssetsInContract",
    type: "error",
    inputs: [
      { name: "_assets", type: "uint256" },
      { name: "_request", type: "uint256" },
    ],
  },
  {
    name: "SlippageTooHigh",
    type: "error",
    inputs: [
      { name: "_minOut", type: "uint256" },
      { name: "_actual", type: "uint256" },
    ],
  },
  { name: "BadSwapper", type: "error", inputs: [] },
  {
    name: "InvalidPath",
    type: "error",
    inputs: [
      { name: "_expected", type: "address" },
      { name: "_actual", type: "address" },
    ],
  },
  { name: "BadProtocolFee", type: "error", inputs: [] },
  {
    name: "PastDeadline",
    type: "error",
    inputs: [
      { name: "_blockTimestamp", type: "uint256" },
      { name: "_deadline", type: "uint256" },
    ],
  },
  { name: "SetterRevoked", type: "error", inputs: [] },
  { name: "ExceedsMaxOracleDeviation", type: "error", inputs: [] },
  { name: "InvalidReceiver", type: "error", inputs: [] },
  { name: "ZeroAddress", type: "error", inputs: [] },
  { name: "AssetEqualsCollateral", type: "error", inputs: [] },
  { name: "InvalidOracleDeviation", type: "error", inputs: [] },
  { name: "InvalidUtilizationRate", type: "error", inputs: [] },
  { name: "InvalidLTV", type: "error", inputs: [] },
  { name: "InvalidLiquidationFee", type: "error", inputs: [] },
  { name: "InvalidProtocolFee", type: "error", inputs: [] },
  { name: "InvalidSeedAmount", type: "error", inputs: [] },
  { name: "InsufficientLiquidatorBonus", type: "error", inputs: [] },
  { name: "MaxLTVTooHighForLiquidationFee", type: "error", inputs: [] },
  { name: "OnlyProtocolOrOwner", type: "error", inputs: [] },
  { name: "OnlyTimelockOrOwner", type: "error", inputs: [] },
  { name: "ExceedsBorrowLimit", type: "error", inputs: [] },
  { name: "AccessControlRevoked", type: "error", inputs: [] },
  { name: "RepayPaused", type: "error", inputs: [] },
  { name: "ExceedsDepositLimit", type: "error", inputs: [] },
  { name: "WithdrawPaused", type: "error", inputs: [] },
  { name: "LiquidatePaused", type: "error", inputs: [] },
  { name: "InterestPaused", type: "error", inputs: [] },
  { name: "NothingToRepay", type: "error", inputs: [] },
  { name: "InsufficientGasForGuard", type: "error", inputs: [] },
  // --- Events ---
  {
    name: "RepayAsset",
    type: "event",
    inputs: [
      { name: "payer", type: "address", indexed: true },
      { name: "borrower", type: "address", indexed: true },
      { name: "amountToRepay", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
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
  {
    name: "getReserveCaps",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "borrowCap", type: "uint256" },
      { name: "supplyCap", type: "uint256" },
    ],
  },
  {
    name: "getTotalDebt",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getPaused",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "isPaused", type: "bool" }],
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

// -----------------------------------------------------------------------------
// DefaultReserveInterestRateStrategyV2 (Aave v3.2): per-reserve parameters, in ray
// -----------------------------------------------------------------------------
export const INTEREST_RATE_STRATEGY_V2_ABI = [
  {
    name: "getBaseVariableBorrowRate",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "reserve", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getVariableRateSlope1",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "reserve", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getVariableRateSlope2",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "reserve", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getOptimalUsageRatio",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "reserve", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// -----------------------------------------------------------------------------
// LuminaPriceGuard (lumina-oracle contracts/lighter/LuminaPriceGuard.sol)
// -----------------------------------------------------------------------------
export const PRICE_GUARD_ABI = [
  {
    name: "borrowStatus",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "status", type: "uint8" },
      { name: "marketId", type: "uint16" },
    ],
  },
  {
    name: "isBorrowAllowed",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// -----------------------------------------------------------------------------
// LighterDualOracle (isolated pair oracle): rate = collateral per asset x 1e18
// -----------------------------------------------------------------------------
export const DUAL_ORACLE_ABI = [
  {
    name: "getPrices",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "isBadData", type: "bool" },
      { name: "priceLow", type: "uint256" },
      { name: "priceHigh", type: "uint256" },
    ],
  },
  { name: "InsufficientGasForGuard", type: "error", inputs: [] },
] as const;

// -----------------------------------------------------------------------------
// Multicall3 (block stamp for freshness)
// -----------------------------------------------------------------------------
export const MULTICALL3_ABI = [
  {
    name: "getBlockNumber",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "blockNumber", type: "uint256" }],
  },
  {
    name: "getCurrentBlockTimestamp",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "timestamp", type: "uint256" }],
  },
] as const;
