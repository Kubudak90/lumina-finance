"use client";

import { useRpcChainStatus, LUMINA_CHAIN_ID } from "@/hooks/chain";
import { NETWORK_NAME } from "@/lib/chains";

/**
 * Blocking banner when the configured RPC is not chain 19529 (or cannot be reached). Reads,
 * simulations and actions stay disabled meanwhile (hooks/chain gates them; the transport refuses).
 */
export function RpcChainBanner() {
  const rpc = useRpcChainStatus();
  if (rpc.status !== "mismatch" && rpc.status !== "error") return null;
  return (
    <div role="alert" className="fixed top-16 left-0 right-0 z-50 bg-red-600/90 text-white px-4 py-3">
      <div className="max-w-7xl mx-auto text-sm font-medium">
        {rpc.status === "mismatch"
          ? `The configured RPC reports chain ${rpc.rpcChainId ?? "unknown"}, not ${NETWORK_NAME} (${LUMINA_CHAIN_ID}). All reads and actions are disabled.`
          : `The ${NETWORK_NAME} RPC cannot be reached to verify its chain. All reads and actions are disabled.`}
      </div>
    </div>
  );
}
