import dynamic from "next/dynamic";

/**
 * `ssr: false` keeps `lighter-ts` and the WASM signer out of the server bundle
 * and out of lending-page client chunks. Do not statically import the runtime.
 */
const LighterReadOnlyView = dynamic(
  () => import("@/lib/lighter/runtime/session").then((mod) => mod.LighterReadOnlyView),
  {
    ssr: false,
    loading: () => <p className="text-sm text-text-dim">Loading Lighter…</p>,
  }
);

export default function LighterPage() {
  return <LighterReadOnlyView />;
}
