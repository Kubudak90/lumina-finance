"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { LUMINA_CHAIN_ID } from "@/lib/deployments";
import { NETWORK_NAME } from "@/lib/chains";
import { isLighterPath } from "@/lib/lighter/config";

/**
 * Wrong-network banner for lending pages. Action buttons are disabled independently
 * (TxButton → useActionGate); this only offers the switch. `/lighter` is read-only trading data
 * and never prompts a switch.
 */
export function NetworkGuard() {
  const pathname = usePathname();
  const onLighter = isLighterPath(pathname);
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const wrongChain = isConnected && chainId !== undefined && chainId !== LUMINA_CHAIN_ID;

  useEffect(() => {
    if (onLighter || !wrongChain) return;
    switchChain({ chainId: LUMINA_CHAIN_ID });
  }, [onLighter, wrongChain, switchChain]);

  if (onLighter || !wrongChain) return null;

  return (
    <div className="fixed top-16 left-0 right-0 z-40 bg-amber-500/15 backdrop-blur-md border-b border-amber-500/20 text-amber-300 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-600 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-600" />
          </span>
          <span className="text-sm font-medium">
            Wrong network: Lumina runs on {NETWORK_NAME} (chain {LUMINA_CHAIN_ID}). Actions are disabled.
          </span>
        </div>
        <button
          onClick={() => switchChain({ chainId: LUMINA_CHAIN_ID })}
          disabled={isPending}
          className="text-sm font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "Switching..." : `Switch to ${NETWORK_NAME}`}
        </button>
      </div>
    </div>
  );
}
