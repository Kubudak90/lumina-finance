"use client";

import type { ReactNode } from "react";
import { WagmiProvider, custom, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, getDefaultConfig, lightTheme } from "@rainbow-me/rainbowkit";
import { injectedWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { luminaChain, rpcUrlFor } from "@/lib/chains";
import { chainCheckedTransport } from "@/lib/rpcGuard";
import { defaultQueryClientOptions } from "@/lib/queryPolicy";
import { RAINBOW_ACCENTS } from "@/lib/theme/theme";
import { useTheme } from "@/providers/ThemeProvider";
import "@rainbow-me/rainbowkit/styles.css";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "";
const rpcUrl = rpcUrlFor(luminaChain.id);

/**
 * Without an RPC URL every request fails fast with a clear error instead of falling back to a
 * public endpoint; the UI shows "RPC not configured" and disables actions.
 */
const unconfiguredTransport = custom({
  request: async () => {
    throw new Error("Lumina RPC not configured (NEXT_PUBLIC_LIGHTER_DEVNET_RPC_URL)");
  },
});

/**
 * The lending config has exactly one chain: Lighter EVM devnet (19529). No Ethereum mainnet: the
 * read-only /lighter view only needs the connected address, not an L1 chain (FE-03).
 *
 * The RPC transport refuses every request until the RPC answers eth_chainId = 19529 (Codex #1).
 *
 * Wallets: injected (desktop MetaMask and any extension, also announced via EIP-6963), Rainbow
 * (injected or WalletConnect) and WalletConnect (mobile wallets, MetaMask mobile included). There is
 * no RainbowKit "MetaMask" entry: it routes through the MetaMask SDK, whose relay the CSP does not
 * allow (Codex #12). The CSP therefore needs only the WalletConnect origins (FE-02).
 */
const config = getDefaultConfig({
  appName: "Lumina Finance",
  projectId: walletConnectProjectId,
  chains: [luminaChain],
  transports: {
    [luminaChain.id]: rpcUrl ? chainCheckedTransport(http(rpcUrl), luminaChain.id) : unconfiguredTransport,
  },
  wallets: [
    {
      groupName: "Wallets",
      wallets: [injectedWallet, rainbowWallet, walletConnectWallet],
    },
  ],
  ssr: true,
});

if (process.env.NODE_ENV === "development") {
  if (!walletConnectProjectId) {
    console.warn("[Web3Provider] NEXT_PUBLIC_WC_PROJECT_ID is not set. WalletConnect will not work.");
  }
  if (!rpcUrl) {
    console.warn("[Web3Provider] NEXT_PUBLIC_LIGHTER_DEVNET_RPC_URL is not set. Lumina reads will fail.");
  }
}

const queryClient = new QueryClient({
  defaultOptions: defaultQueryClientOptions(),
});

const rainbowDark = darkTheme({ ...RAINBOW_ACCENTS.dark, borderRadius: "none", overlayBlur: "small" });
const rainbowLight = lightTheme({ ...RAINBOW_ACCENTS.light, borderRadius: "none", overlayBlur: "small" });

export function Web3Provider({ children }: { children: ReactNode }) {
  // Dark until hydrated (the server's markup), then the resolved theme. ConnectButton renders only
  // after mount and the modal opens only on a click, so neither shows the pre-hydration theme (§3.3).
  const { resolved, mounted } = useTheme();
  const rainbowTheme = mounted && resolved === "light" ? rainbowLight : rainbowDark;
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact" initialChain={luminaChain}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
