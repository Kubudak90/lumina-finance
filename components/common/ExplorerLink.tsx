import { txExplorerUrl } from "@/lib/explorer";

/** Link to a transaction on the manifest's explorer; nothing when the chain has no explorer. */
export function ExplorerLink({ hash, className }: { hash: string; className?: string }) {
  const url = txExplorerUrl(hash);
  if (!url) return <span className="text-xs font-mono text-text-dim break-all">tx {hash}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "text-sm text-accent hover:underline font-mono"}
    >
      View transaction
    </a>
  );
}
