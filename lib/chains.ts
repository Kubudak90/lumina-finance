import { defineChain } from "viem";
import { LUMINA, LUMINA_CHAIN_ID, type LuminaDeployment } from "./deployments";

/**
 * RPC URL per chain, from env. `NEXT_PUBLIC_*` must be referenced literally so Next.js can inline
 * it into the client bundle. The manifest's `rpcEnv` names the server-side variable
 * (LIGHTER_DEVNET_RPC_URL); the client uses the NEXT_PUBLIC_ twin of the same name.
 */
export const RPC_URL_ENV: Readonly<Record<number, string>> = Object.freeze({
  [LUMINA_CHAIN_ID]: "NEXT_PUBLIC_LIGHTER_DEVNET_RPC_URL",
});

const RPC_URLS: Readonly<Record<number, string | undefined>> = Object.freeze({
  [LUMINA_CHAIN_ID]: process.env.NEXT_PUBLIC_LIGHTER_DEVNET_RPC_URL?.trim() || undefined,
});

export function rpcUrlFor(chainId: number): string | undefined {
  return RPC_URLS[chainId];
}

const CHAIN_NAMES: Readonly<Record<number, string>> = Object.freeze({
  [LUMINA_CHAIN_ID]: "Lighter EVM devnet",
});

/** viem chain for a deployment. Explorer and multicall3 come from the manifest. */
export function makeLuminaChain(deployment: LuminaDeployment, rpcUrl: string | undefined) {
  return defineChain({
    id: deployment.chainId,
    name: CHAIN_NAMES[deployment.chainId] ?? `Chain ${deployment.chainId}`,
    nativeCurrency: deployment.nativeCurrency,
    rpcUrls: {
      default: { http: rpcUrl ? [rpcUrl] : [] },
    },
    blockExplorers: deployment.explorer
      ? { default: { name: "Explorer", url: deployment.explorer } }
      : undefined,
    contracts: {
      multicall3: { address: deployment.multicall3 },
    },
    // 1 s blocks: viem derives receipt/block polling from this.
    blockTime: deployment.blockTime,
    testnet: true,
  });
}

/** The only chain of the lending wagmi config. Lighter's trading domain is not an EVM chain here. */
export const luminaChain = makeLuminaChain(LUMINA, rpcUrlFor(LUMINA_CHAIN_ID));

/** Human-readable network name for UI copy. */
export const NETWORK_NAME = luminaChain.name;
