import { defineChain } from "viem";

export const lighterEvm = defineChain({
  id: 1890, // placeholder — update when Lighter publishes chain ID
  name: "Lighter EVM",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.lighter.xyz"] }, // placeholder
  },
  blockExplorers: {
    default: { name: "Lighter Explorer", url: "https://explorer.lighter.xyz" },
  },
});

// For local testing with Foundry anvil
export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});
