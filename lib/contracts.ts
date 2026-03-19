export const LENDING_POOL_ABI = [
  {
    name: "supply",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
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
    ],
    outputs: [],
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
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
    ],
    outputs: [],
  },
  {
    name: "enableCollateral",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "adapter", type: "address" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "liquidate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "borrower", type: "address" },
      { name: "debtAsset", type: "address" },
      { name: "debtAmount", type: "uint256" },
      { name: "collateralAdapter", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "getHealthFactor",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getMarketData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      { name: "totalSupply", type: "uint256" },
      { name: "totalBorrow", type: "uint256" },
      { name: "reserves", type: "uint256" },
      { name: "borrowRate", type: "uint256" },
      { name: "supplyRate", type: "uint256" },
    ],
  },
] as const;

export const ERC20_ABI = [
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
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const DEBT_TOKEN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Addresses — update after deployment
export const ADDRESSES = {
  lendingPool: "0x0000000000000000000000000000000000000000" as `0x${string}`,
  usdc: "0x0000000000000000000000000000000000000001" as `0x${string}`,
  weth: "0x0000000000000000000000000000000000000002" as `0x${string}`,
  usdcAdapter: "0x0000000000000000000000000000000000000003" as `0x${string}`,
  ethAdapter: "0x0000000000000000000000000000000000000004" as `0x${string}`,
  oracle: "0x0000000000000000000000000000000000000005" as `0x${string}`,
} as const;
