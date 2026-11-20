import { z } from "zod";
import { AUTH_STORAGE_THREAT_MODEL } from "./types";

const parseJsonPreprocessor = (value: unknown, ctx: z.RefinementCtx) => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
    }
  }
  return value;
};

/**
 * Namespaced so a shared origin cannot collide with the official example `auth` key. The app is
 * read-only: it never reads or writes the stored signing seed (Codex r1 #13); it can only delete
 * material a previous version stored.
 */
const SIGNATURE_KEY = "lumina.lighter.auth";
const LAST_ACCOUNT_KEY = "lumina.lighter.lastAccountIndex";

export { AUTH_STORAGE_THREAT_MODEL };

export const LIGHTER_SIGNATURE_STORAGE_KEY = SIGNATURE_KEY;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export const removeLSSignature = () => {
  storage()?.removeItem(SIGNATURE_KEY);
};

const accountIndexSchema = z.preprocess(parseJsonPreprocessor, z.number());

export const readLSLastAccountIndex = () =>
  accountIndexSchema.safeParse(storage()?.getItem(LAST_ACCOUNT_KEY));

export const writeLSLastAccountIndex = (value: number) => {
  storage()?.setItem(LAST_ACCOUNT_KEY, JSON.stringify(value));
};

export const removeLSLastAccountIndex = () => {
  storage()?.removeItem(LAST_ACCOUNT_KEY);
};

export const clearLighterAuthMaterial = () => {
  removeLSSignature();
  removeLSLastAccountIndex();
};
