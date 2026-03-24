import { defineChain } from "viem";

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: { name: "BaseScan", url: "https://sepolia.basescan.org" },
  },
  testnet: true,
});

/**
 * LighterEVM chains - reserved for mainnet launch
 */
export const lighterEVM = defineChain({
  id: 304,
  name: "Lighter",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.zklighter.elliot.ai"] },
  },
  blockExplorers: {
    default: { name: "Lighter Explorer", url: "https://scan.lighter.xyz" },
  },
  testnet: false,
});

/**
 * Default chain — Base Sepolia for now, switch to lighterEVM at mainnet launch
 */
export const defaultChain = baseSepolia;
