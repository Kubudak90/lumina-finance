"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig } from "connectkit";
import { defaultChain } from "@/lib/chains";

const config = createConfig(
  getDefaultConfig({
    chains: [defaultChain],
    transports: {
      [defaultChain.id]: http(),
    },
    walletConnectProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "",
    appName: "Lumina Finance",
    // Dev warning is emitted below after config creation
    appDescription: "The first lending protocol on Lighter",
  })
);

if (process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_WC_PROJECT_ID) {
  console.warn(
    "[Web3Provider] NEXT_PUBLIC_WC_PROJECT_ID is not set. WalletConnect will not work. " +
    "Get a project ID at https://cloud.walletconnect.com and add it to your .env.local file."
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 15_000,
      staleTime: 10_000,
    },
  },
});

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider mode="dark" theme="midnight">
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
