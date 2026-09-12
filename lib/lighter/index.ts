/**
 * Public Lighter adapter surface.
 *
 * This file must not import `lighter-ts`. UI code should import from here.
 * The SDK/WASM runtime is loaded only via `next/dynamic` on `/lighter`.
 */

export {
  LIGHTER_L1_CHAIN_ID,
  LIGHTER_REST_URL,
  LIGHTER_SIGNING_CHAIN_ID,
  LIGHTER_TS_VERSION,
  LIGHTER_WASM_URL,
  LIGHTER_WS_URL,
  isLighterPath,
} from "./config";
export {
  AUTH_STORAGE_THREAT_MODEL,
  clearLighterAuthMaterial,
  readLSAccountSignature,
  writeLSAccountSignature,
} from "./auth-storage";
export { logLighterError, redactForLog } from "./errors";
export type {
  LighterAccountExistence,
  LighterBalance,
  LighterEquity,
  LighterPosition,
  LighterSnapshot,
} from "./types";
export {
  displayPriceToReal,
  displaySizeToReal,
  getDisplayDecimals,
  realPriceToDisplay,
  realSizeToDisplay,
} from "./units";
