import { LUMINA, LUMINA_CHAIN_ID, isDeployed } from "@/lib/deployments";
import { NETWORK_NAME, RPC_URL_ENV, rpcUrlFor } from "@/lib/chains";

/** Explains why nothing loads: manifest still a template, or no RPC URL in the build. */
export function DeploymentNotice() {
  const deployed = isDeployed(LUMINA);
  const rpc = rpcUrlFor(LUMINA_CHAIN_ID);
  if (deployed && rpc) return null;
  return (
    <div className="technical-border bg-amber-500/10 border-amber-500/30 p-4 text-sm text-amber-300 space-y-1">
      {!deployed && (
        <p>
          Lumina is not deployed on {NETWORK_NAME} (chain {LUMINA_CHAIN_ID}) yet: the deployment manifest is still a
          template, so markets and actions are disabled.
        </p>
      )}
      {!rpc && (
        <p>
          No RPC configured for {NETWORK_NAME}: set <code className="font-mono">{RPC_URL_ENV[LUMINA_CHAIN_ID]}</code> at build
          time.
        </p>
      )}
    </div>
  );
}
