"use client";

import { useAccount } from "wagmi";
import { defaultChain } from "@/lib/chains";

export function NetworkBadge() {
  const { chain, isConnected } = useAccount();

  if (!isConnected) return null;

  const isCorrect = chain?.id === defaultChain.id;

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
      {isCorrect ? chain.name : chain?.name ?? "Unknown"}
    </div>
  );
}
