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

// Deployed on Base Sepolia (chain ID 84532)
export const ADDRESSES = {
  lendingPool: "0x1C79C848a5e0a17D86D44Cb2ac9714214EdFaD3d" as `0x${string}`,
  usdc: "0xC5DF09eE5B4a6C2dbd3ACb3845693A4FCc978A36" as `0x${string}`,
  weth: "0xa46f75bF3C47DCD48103A2f16013a0c7b735f491" as `0x${string}`,
  usdcAdapter: "0x6b58FcB5B30D58653622929217A8dB6AAe72c37d" as `0x${string}`,
  ethAdapter: "0xcF11f4926dD1eCE26fE8Ce868356d0CD5c57F0fc" as `0x${string}`,
  oracle: "0xA4189fc3818AbA2d4F26E980480420334ab65557" as `0x${string}`,
} as const;
