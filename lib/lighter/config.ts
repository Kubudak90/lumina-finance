/**
 * Lighter trading-domain config.
 *
 * Lighter is accessed through REST, WebSocket, and the official signer.
 * It is not a general-purpose EVM and must never be passed to wagmi/viem
 * as an HTTP transport for Solidity contract calls.
 *
 * Only files under `lib/lighter/runtime/` (and unit tests) may import `lighter-ts`.
 * The 7.5 MiB Go WASM signer is fetched at runtime from the official example
 * and must not be imported from lending routes.
 *
 * Official React example: `elliottech/lighter-ts@1.0.2` examples/react
 * (wagmi connects to Ethereum mainnet; signing chain id is 304).
 */

export const LIGHTER_TS_VERSION = "1.0.2";

/** Lighter signing domain — not an EVM RPC chain id. */
export const LIGHTER_SIGNING_CHAIN_ID = 304;

/** Ethereum mainnet, as used by the official `examples/react/src/wagmi.ts`. */
export const LIGHTER_L1_CHAIN_ID = 1;

export const LIGHTER_REST_URL = "https://mainnet.zklighter.elliot.ai";

export const LIGHTER_WS_URL = "wss://mainnet.zklighter.elliot.ai/stream";

/**
 * Official example WASM (not shipped in the npm tarball).
 * Override with `NEXT_PUBLIC_LIGHTER_WASM_URL` to vendor it.
 */
export const LIGHTER_WASM_URL =
  process.env.NEXT_PUBLIC_LIGHTER_WASM_URL ||
  "https://cdn.jsdelivr.net/gh/elliottech/lighter-ts@1.0.2/examples/react/src/lib/signers/wasm/main.wasm";

export const LIGHTER_WASM_EXEC_URL = "/lighter/wasm_exec.js";

export const LIGHTER_WS_FLUSH_INTERVAL_MS = 250;
export const LIGHTER_WS_THROTTLE_INTERVAL_MS = 500;
export const LIGHTER_WS_PING_INTERVAL_MS = 2500;
export const LIGHTER_WS_PONG_TIMEOUT_MS = 12000;

/** Lending NetworkGuard must not auto-switch wallets away from Ethereum on this route. */
export function isLighterPath(pathname: string | null | undefined): boolean {
  return Boolean(pathname?.startsWith("/lighter"));
}
