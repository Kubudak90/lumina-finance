import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIGHTER_SIGNATURE_STORAGE_KEY,
  clearLighterAuthMaterial,
  readLSLastAccountIndex,
  writeLSLastAccountIndex,
} from "./auth-storage";
import * as authStorage from "./auth-storage";

function installLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("window", { localStorage });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Lighter auth storage (read-only adapter)", () => {
  it("exposes no way to read or write the signing seed", () => {
    expect(Object.keys(authStorage).filter((k) => /AccountSignature|Seed/i.test(k))).toEqual([]);
  });

  it("namespaces keys and clears legacy seed material on logout", () => {
    const store = installLocalStorage();
    store.set(LIGHTER_SIGNATURE_STORAGE_KEY, JSON.stringify({ 1: { 0: { pk: "pub", seed: "legacy-seed" } } }));
    writeLSLastAccountIndex(1);

    expect(LIGHTER_SIGNATURE_STORAGE_KEY).toBe("lumina.lighter.auth");
    expect(store.has("lumina.lighter.lastAccountIndex")).toBe(true);
    expect(readLSLastAccountIndex().success).toBe(true);

    clearLighterAuthMaterial();

    expect(readLSLastAccountIndex().success).toBe(false);
    expect(store.size).toBe(0);
  });
});
