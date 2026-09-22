import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLighterAuthMaterial,
  readLSAccountSignature,
  readLSLastAccountIndex,
  writeLSAccountSignature,
  writeLSLastAccountIndex,
} from "./auth-storage";

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

describe("Lighter auth storage", () => {
  it("namespaces keys and clears seed material on logout", () => {
    const store = installLocalStorage();
    writeLSAccountSignature(1, 0, { pk: "pub", seed: "secret-seed" });
    writeLSLastAccountIndex(1);

    expect(store.has("lumina.lighter.auth")).toBe(true);
    expect(store.has("lumina.lighter.lastAccountIndex")).toBe(true);
    expect(store.has("auth")).toBe(false);
    expect(readLSAccountSignature(1, 0)).toEqual({ pk: "pub", seed: "secret-seed" });
    expect(readLSLastAccountIndex().success).toBe(true);

    clearLighterAuthMaterial();

    expect(readLSAccountSignature(1, 0)).toBeUndefined();
    expect(readLSLastAccountIndex().success).toBe(false);
    expect(store.size).toBe(0);
  });
});
