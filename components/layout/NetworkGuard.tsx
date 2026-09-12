"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { defaultChain } from "@/lib/chains";
import { isLighterPath } from "@/lib/lighter";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function NetworkGuard() {
  const pathname = usePathname();
  const onLighter = isLighterPath(pathname);
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  // Lending pages stay on Base Sepolia. `/lighter` uses Ethereum mainnet as L1
  // (official lighter-ts example) and must not be force-switched.
  useEffect(() => {
    if (onLighter) return;
    if (isConnected && chain && chain.id !== defaultChain.id) {
      switchChain({ chainId: defaultChain.id });
    }
  }, [onLighter, isConnected, chain, switchChain]);

  if (onLighter || !isConnected || !chain || chain.id === defaultChain.id) return null;

  return (
    <div className="fixed top-16 left-0 right-0 z-40 bg-amber-500/15 backdrop-blur-md border-b border-amber-500/20 text-amber-300 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-600 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
          </span>
          <span className="text-sm font-medium">
            Wrong network — Lumina Finance runs on {defaultChain.name}
          </span>
        </div>
        <button
          onClick={() => switchChain({ chainId: defaultChain.id })}
          disabled={isPending}
          className="text-sm font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "Switching..." : `Switch to ${defaultChain.name}`}
        </button>
      </div>
    </div>
  );
}
