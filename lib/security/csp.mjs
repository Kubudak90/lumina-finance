// Security headers (FE-02). Plain ESM so `next.config.mjs` and the vitest suite share one source.
//
// The CSP is static (next.config `headers()`), so it cannot carry per-request nonces: scripts are
// limited to 'self' plus inline (Next.js App Router bootstraps with inline scripts). Everything
// that leaves the page is restricted to the origins the app actually needs:
//   - the Lumina RPC (NEXT_PUBLIC_LIGHTER_DEVNET_RPC_URL, read at build time);
//   - WalletConnect (relay, verify, RPC proxy, telemetry);
//   - the read-only Lighter trading domain (REST + WebSocket) used by /lighter and /portfolio.
// No third-party price API, no jsDelivr: the Lighter WASM signer stays blocked until it is vendored
// (FE-10).

/** WalletConnect v2 endpoints used by @walletconnect/core and the ethereum-provider (dapp side). */
export const WALLETCONNECT_CONNECT_SRC = Object.freeze([
  "wss://relay.walletconnect.org",
  "wss://relay.walletconnect.com",
  "https://rpc.walletconnect.org",
  "https://rpc.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://verify.walletconnect.com",
  "https://pulse.walletconnect.org",
]);

/** WalletConnect Verify loads an attestation iframe. */
export const WALLETCONNECT_FRAME_SRC = Object.freeze([
  "https://verify.walletconnect.org",
  "https://verify.walletconnect.com",
]);

/** Read-only Lighter trading domain (lib/lighter/config.ts). */
export const LIGHTER_TRADING_CONNECT_SRC = Object.freeze([
  "https://mainnet.zklighter.elliot.ai",
  "wss://mainnet.zklighter.elliot.ai",
]);

/**
 * Origin of the RPC URL, or null if it is unset or not http(s). Credentials and paths are dropped:
 * the CSP only ever names an origin. Plain http is accepted only for loopback (local harness).
 * @param {string | undefined | null} rpcUrl
 * @returns {string | null}
 */
export function rpcOrigin(rpcUrl) {
  if (typeof rpcUrl !== "string" || rpcUrl.trim() === "") return null;
  let url;
  try {
    url = new URL(rpcUrl.trim());
  } catch {
    return null;
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && loopback) return url.origin;
  return null;
}

/**
 * @param {{ rpcUrl?: string | null, dev?: boolean }} [options]
 * @returns {string}
 */
export function buildCsp(options = {}) {
  const { rpcUrl, dev = false } = options;
  const rpc = rpcOrigin(rpcUrl);
  const connectSrc = [
    "'self'",
    ...(rpc ? [rpc] : []),
    ...WALLETCONNECT_CONNECT_SRC,
    ...LIGHTER_TRADING_CONNECT_SRC,
    // next dev uses a websocket for HMR.
    ...(dev ? ["ws://localhost:*", "ws://127.0.0.1:*"] : []),
  ];
  const directives = [
    ["default-src", ["'self'"]],
    // 'unsafe-inline': Next.js inline bootstrap scripts (no nonces with static headers).
    // 'wasm-unsafe-eval': WebAssembly compilation only (no JS eval). 'unsafe-eval' is dev-only.
    ["script-src", ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connectSrc],
    ["frame-src", [...WALLETCONNECT_FRAME_SRC]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "bluetooth=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "serial=()",
  "usb=()",
].join(", ");

/**
 * Headers for every route (`next.config.mjs` → headers()).
 * @param {{ rpcUrl?: string | null, dev?: boolean }} [options]
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders(options = {}) {
  return [
    { key: "Content-Security-Policy", value: buildCsp(options) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
}
