"use client";

import type { RequestContext, ResponseContext } from "zklighter-perps";
import { queryClient, useLighterStore } from "lighter-ts";
import { removeLSSignature } from "../auth-storage";
import { logLighterError } from "../errors";
import { getOrCreateAuthToken, resetAuthToken } from "./auth";

const SKIPPED_AUTH_URLS = ["nextNonce"];
const CANDLESTICK_URLS = ["api/v1/candles", "api/v1/markPriceCandles"];

export const authTokenInHeaderMiddleware = {
  pre: async (requestContext: RequestContext) => {
    const url = new URL(requestContext.url);
    const headers = new Headers(requestContext.init.headers);

    if (SKIPPED_AUTH_URLS.some((part) => requestContext.url.includes(part))) {
      return {
        ...requestContext,
        url: url.toString(),
        init: { ...requestContext.init, headers },
      };
    }

    if (CANDLESTICK_URLS.some((part) => requestContext.url.includes(part))) {
      url.searchParams.set("optimize", "true");
    }

    const auth = await getOrCreateAuthToken(useLighterStore.getState().accountIndex);
    if (auth) {
      headers.set("PreferAuthServer", "true");
      headers.set("Authorization", auth.token);
    }
    return {
      ...requestContext,
      url: url.toString(),
      init: { ...requestContext.init, headers },
    };
  },
};

const handleInvalidSignature = async (response: Response) => {
  if (response.status !== 400) return false;
  try {
    const body = (await response.clone().json()) as { code: number; message: string };
    if (body.code === 29500 && body.message.includes("invalid signature")) {
      removeLSSignature();
      resetAuthToken();
      queryClient.removeQueries({ queryKey: ["isRegistered"] });
      return true;
    }
  } catch (error) {
    logLighterError(error, "invalid-signature-parse");
  }
  return false;
};

export const handleServerErrorMiddleware = {
  post: async (responseContext: ResponseContext) => {
    const { response, init } = responseContext;
    if (await handleInvalidSignature(response)) return;
    if (init.method !== "GET") return;
    if (response.status !== 405 && response.status !== 429) return;
    logLighterError({ status: response.status }, "health-warning");
  },
};
