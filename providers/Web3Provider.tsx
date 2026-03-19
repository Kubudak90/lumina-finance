"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider, getDefaultConfig } from "connectkit";
import { anvil } from "@/lib/chains";

const config = createConfig(
  getDefaultConfig({
    chains: [anvil],
    transports: {
      [anvil.id]: http(),
    },
    walletConnectProjectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "",
    appName: "LightLend",
    appDescription: "Lending protocol on Lighter EVM",
  })
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 15_000, // 15 seconds
      staleTime: 10_000,
    },
  },
});

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider theme="midnight">
          {children}
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
