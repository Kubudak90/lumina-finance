"use client";

import type { ReactNode } from "react";
import { WagmiProvider, http } from "wagmi";
import { mainnet } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defaultChain } from "@/lib/chains";
import { defaultQueryClientOptions } from "@/lib/queryPolicy";
import "@rainbow-me/rainbowkit/styles.css";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "";

const config = getDefaultConfig({
  appName: "Lumina Finance",
  projectId: walletConnectProjectId,
  // Ethereum is the L1 used by the official lighter-ts example. Lending stays
  // on Base Sepolia; NetworkGuard only auto-switches off `/lighter`.
  chains: [defaultChain, mainnet],
  transports: {
    [defaultChain.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true,
});

if (process.env.NODE_ENV === "development" && !walletConnectProjectId) {
  console.warn(
    "[Web3Provider] NEXT_PUBLIC_WC_PROJECT_ID is not set. WalletConnect will not work. " +
      "Get a project ID at https://cloud.walletconnect.com and add it to your .env.local file."
  );
}

const queryClient = new QueryClient({
  defaultOptions: defaultQueryClientOptions(),
});

const rainbowTheme = darkTheme({
  accentColor: "#B0C4FF",
  accentColorForeground: "#09090b",
  borderRadius: "none",
  overlayBlur: "small",
});

export function Web3Provider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={rainbowTheme} modalSize="compact" initialChain={defaultChain}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
