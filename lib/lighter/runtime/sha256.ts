"use client";

import type { Sha256 } from "lighter-ts";

export const sha256: Sha256 = {
  digest: async (data) => {
    const cryptoObj = globalThis.crypto;
    if (!cryptoObj?.subtle) throw new Error("sha256: crypto.subtle is not available");
    const hashBuffer = await cryptoObj.subtle.digest("SHA-256", data as BufferSource);
    return new Uint8Array(hashBuffer);
  },
};
