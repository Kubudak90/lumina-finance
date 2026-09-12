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

const signatureRecordSchema = z.object({ pk: z.string(), seed: z.string() });
const signatureSchema = z.preprocess(
  parseJsonPreprocessor,
  z.record(z.string(), z.record(z.string(), signatureRecordSchema))
);

type SignatureRecord = z.infer<typeof signatureRecordSchema>;
type Signatures = z.infer<typeof signatureSchema>;

/** Namespaced so a shared origin cannot collide with the official example `auth` key. */
const SIGNATURE_KEY = "lumina.lighter.auth";
const LAST_ACCOUNT_KEY = "lumina.lighter.lastAccountIndex";

export { AUTH_STORAGE_THREAT_MODEL };

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

const readLSSignature = (): Signatures => {
  const raw = storage()?.getItem(SIGNATURE_KEY);
  const parsed = signatureSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
};

const writeLSSignature = (value: Signatures) => {
  storage()?.setItem(SIGNATURE_KEY, JSON.stringify(value));
};

export const removeLSSignature = () => {
  storage()?.removeItem(SIGNATURE_KEY);
};

export const readLSAccountSignature = (accountIndex: number, apiKeyIndex: number) => {
  return readLSSignature()[String(accountIndex)]?.[String(apiKeyIndex)];
};

export const writeLSAccountSignature = (
  accountIndex: number,
  apiKeyIndex: number,
  signature: SignatureRecord
) => {
  const signatures = readLSSignature();
  writeLSSignature({
    ...signatures,
    [accountIndex]: {
      ...signatures[accountIndex],
      [apiKeyIndex]: signature,
    },
  });
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
