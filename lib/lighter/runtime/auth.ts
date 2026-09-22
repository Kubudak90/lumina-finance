"use client";

import { queryClient, transactionConfig } from "lighter-ts";
import { readLSAccountSignature } from "../auth-storage";

export const isRegistered = (accountIndex: number) =>
  Boolean(queryClient.getQueryData(["isRegistered", accountIndex]));

const memoryCacheAuthToken: Record<number, string> = {};
const tokenDeadline: Record<number, number> = {};

const createNewAuthToken = async (accountIndex: number): Promise<string> => {
  const { token, deadline } = await transactionConfig.signers.createAuthToken({
    accountIndex,
    apiKeyIndex: transactionConfig.getApiKeyIndex(),
  });
  memoryCacheAuthToken[accountIndex] = token;
  tokenDeadline[accountIndex] = deadline;
  return token;
};

const isTokenExpiringSoon = (accountIndex: number): boolean => {
  const deadline = tokenDeadline[accountIndex];
  if (!deadline) return true;
  return deadline * 1000 - Date.now() < 10 * 60 * 1000;
};

export const getOrCreateAuthToken = async (accountIndex?: number) => {
  if (!accountIndex) return undefined;
  if (!isRegistered(accountIndex)) return undefined;
  if (!readLSAccountSignature(accountIndex, transactionConfig.getApiKeyIndex())) return undefined;
  if (!memoryCacheAuthToken[accountIndex] || isTokenExpiringSoon(accountIndex)) {
    await createNewAuthToken(accountIndex);
  }
  return { token: memoryCacheAuthToken[accountIndex]! };
};

export const resetAuthToken = () => {
  for (const key of Object.keys(memoryCacheAuthToken)) {
    delete memoryCacheAuthToken[Number(key)];
    delete tokenDeadline[Number(key)];
  }
};
