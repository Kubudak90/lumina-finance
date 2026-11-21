"use client";

import { useAccount } from "wagmi";
import { LUMINA_CHAIN_ID } from "@/lib/deployments";
import { NETWORK_NAME } from "@/lib/chains";

export function NetworkBadge() {
  const { chainId, isConnected } = useAccount();

  if (!isConnected) return null;

  const isCorrect = chainId === LUMINA_CHAIN_ID;

  return (
    <div
      className={`
        flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono uppercase tracking-wider border
        transition-colors
        ${
          isCorrect
            ? "bg-accent/10 text-accent border-accent/30"
            : "bg-red-500/10 text-red-400 border-red-500/20"
        }
      `}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isCorrect ? "bg-accent" : "bg-red-500 animate-pulse"
        }`}
      />
      {isCorrect ? NETWORK_NAME : `Wrong chain (${chainId ?? "?"})`}
    </div>
  );
}
