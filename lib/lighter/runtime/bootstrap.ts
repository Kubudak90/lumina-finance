"use client";

import { API_KEY_INDEXES, initCommonPackage, Platform, useLighterStore } from "lighter-ts";
import { logLighterError } from "../errors";
import { apis } from "./apis";
import { isRegistered } from "./auth";
import { persistence } from "./persistence";
import { sha256 } from "./sha256";
import { signers } from "./wasm";
import {
  LIGHTER_WS_FLUSH_INTERVAL_MS,
  LIGHTER_WS_THROTTLE_INTERVAL_MS,
} from "../config";

let initialized = false;

export function ensureLighterRuntime(): void {
  if (initialized) return;
  if (typeof window === "undefined") {
    throw new Error("Lighter runtime must be initialized in the browser");
  }

  initCommonPackage({
    setItem: persistence.setItem,
    getItem: persistence.getItem,
    sha256,
    accountApi: apis.accountApi,
    announcementApi: apis.announcementApi,
    bridgeApi: apis.bridgeApi,
    candlesticksApi: apis.candlesticksApi,
    fundingApi: apis.fundingApi,
    infoApi: apis.infoApi,
    notificationApi: apis.notificationApi,
    orderApi: apis.orderApi,
    referralApi: apis.referralApi,
    rootApi: apis.rootApi,
    stockFinancialsApi: apis.stockFinancialsApi,
    tokenlistApi: apis.tokenlistApi,
    transactionApi: apis.transactionApi,
    atomicordersApi: apis.atomicordersApi,
    marketNewsApi: apis.marketNewsApi,
    env: "mainnet",
    websocketConfigParam: {
      flushInterval: LIGHTER_WS_FLUSH_INTERVAL_MS,
      throttleInterval: LIGHTER_WS_THROTTLE_INTERVAL_MS,
    },
    captureException: (exception, hint) => {
      logLighterError({ exception, hint }, "captureException");
      return "";
    },
    showToastFromError: (error) => {
      logLighterError(error, "toast");
    },
    signers,
    getApiKeyIndex: () => API_KEY_INDEXES.DESKTOP,
    getPlatform: () => Platform.PlatformWeb,
    isRegistered,
    skipNonce: true,
  });

  useLighterStore.getState().loadPreferences();
  initialized = true;
}

export { API_KEY_INDEXES };
