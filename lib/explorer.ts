import { defaultChain } from "./chains";

export function txExplorerUrl(hash: string): string {
  const base = defaultChain.blockExplorers.default.url.replace(/\/$/, "");
  return `${base}/tx/${hash}`;
}
