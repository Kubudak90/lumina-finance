/**
 * Lighter trading-domain config.
 *
 * Lighter is accessed through REST, WebSocket, and the official signer.
 * It is not a general-purpose EVM and must never be passed to wagmi/viem
 * as an HTTP transport for Solidity contract calls.
 *
 * Only files under `lib/lighter/` may import `lighter-ts`.
 */

export const LIGHTER_SIGNING_CHAIN_ID = 304;

export const LIGHTER_REST_URL = "https://mainnet.zklighter.elliot.ai";

export const LIGHTER_WS_URL = "https://mainnet.zklighter.elliot.ai/stream";
