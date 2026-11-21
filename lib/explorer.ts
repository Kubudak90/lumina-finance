import { LUMINA } from "./deployments";

/** Explorer URL for a transaction, or null when the manifest has no explorer for this chain. */
export function txExplorerUrl(hash: string, explorer: string | null = LUMINA.explorer): string | null {
  if (!explorer) return null;
  return `${explorer.replace(/\/$/, "")}/tx/${hash}`;
}

/** Open an explorer link without giving the new tab a handle on this window (FE-14). */
export function openExplorer(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Toast action for a confirmed transaction, or undefined when there is no explorer. */
export function explorerToastAction(hash: string, label = "View on Explorer") {
  const url = txExplorerUrl(hash);
  return url ? { label, onClick: () => openExplorer(url) } : undefined;
}
