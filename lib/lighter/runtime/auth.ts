"use client";

/**
 * Read-only adapter: no API-key signing. The stored signing seed is never read (Codex r1 #13), so
 * no authenticated WebSocket token is ever created; private streams stay unavailable.
 */
export const getOrCreateAuthToken = async (accountIndex?: number): Promise<{ token: string } | undefined> => {
  void accountIndex;
  return undefined;
};

export const resetAuthToken = () => {};

/** No API key is ever registered in the read-only adapter. */
export const isRegistered = (accountIndex: number): boolean => {
  void accountIndex;
  return false;
};
