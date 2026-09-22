"use client";

import type { Signers } from "lighter-ts";
import { LIGHTER_WASM_EXEC_URL, LIGHTER_WASM_URL } from "../config";
import { logLighterError } from "../errors";

type WasmError = { error: string };

declare global {
  interface Window {
    Go: new () => { importObject: WebAssembly.Imports; run: (instance: WebAssembly.Instance) => void };
    _signCreateOrder: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signCreateGroupedOrders: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signCancelOrder: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signCancelAllOrders: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signModifyOrder: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signUpdateMargin: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signUpdateLeverage: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signUpdateAccountConfig: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signUpdateAccountAssetConfig: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signCreateSubAccount: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signCreatePublicPool: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signMintShares: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signBurnShares: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signUpdatePublicPool: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signStakeAssets: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signUnstakeAssets: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _getTransferTransaction: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signTransfer: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _getApproveIntegratorTransaction: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signApproveIntegrator: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signWithdraw: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _createClient: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _createAuthToken: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _getChangePubKeyTransaction: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _getRevokePubKeyTransaction: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signChangePubKey: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _signRevokePubKey: (...args: unknown[]) => Promise<() => Promise<unknown>>;
    _getAirdropAllocationMessage: (...args: unknown[]) => Promise<() => Promise<unknown>>;
  }
}

const processWasmCall = async <T>(wasmCall: Promise<() => Promise<T>>) => (await wasmCall)();

const processWasmError = <T>(wasmResponse: T | WasmError): T => {
  if (wasmResponse && typeof wasmResponse === "object" && "error" in wasmResponse) {
    const error = new Error((wasmResponse as WasmError).error);
    logLighterError(error, "wasm");
    throw error;
  }
  return wasmResponse as T;
};

let wasm: Promise<WebAssembly.WebAssemblyInstantiatedSource> | null = null;
let wasmReadyResolve: (value: unknown) => void = () => undefined;
const wasmReady = new Promise((resolve) => {
  wasmReadyResolve = resolve;
});

export async function waitForWasm() {
  return wasmReady;
}

async function loadWasmExec(): Promise<void> {
  if (typeof window.Go === "function") return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LIGHTER_WASM_EXEC_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load wasm_exec.js"));
    document.head.appendChild(script);
  });
}

export async function initWASM(): Promise<void> {
  if (wasm !== null) {
    await wasm;
    return;
  }
  await loadWasmExec();
  const go = new window.Go();
  const wasmUrl = LIGHTER_WASM_URL;

  if (WebAssembly.instantiateStreaming) {
    wasm = WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject).catch(() =>
      fetch(wasmUrl)
        .then((response) => response.arrayBuffer())
        .then((buffer) => WebAssembly.instantiate(buffer, go.importObject))
    );
  } else {
    wasm = fetch(wasmUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => WebAssembly.instantiate(buffer, go.importObject));
  }

  const instance = await wasm.then(({ instance }) => instance);
  void go.run(instance);
  setTimeout(() => wasmReadyResolve(true), 10);
}

function disabled(name: string): never {
  throw new Error(`Lighter read-only adapter: ${name} is not enabled`);
}

export const signers: Signers = {
  signCreateOrder: () => disabled("signCreateOrder"),
  signCreateGroupedOrders: () => disabled("signCreateGroupedOrders"),
  signCancelOrder: () => disabled("signCancelOrder"),
  signCancelAllOrders: () => disabled("signCancelAllOrders"),
  signModifyOrder: () => disabled("signModifyOrder"),
  signUpdateMargin: () => disabled("signUpdateMargin"),
  signUpdateLeverage: () => disabled("signUpdateLeverage"),
  signUpdateAccountConfig: () => disabled("signUpdateAccountConfig"),
  signUpdateAccountAssetConfig: () => disabled("signUpdateAccountAssetConfig"),
  signCreateSubAccount: () => disabled("signCreateSubAccount"),
  signCreatePublicPool: () => disabled("signCreatePublicPool"),
  signMintShares: () => disabled("signMintShares"),
  signBurnShares: () => disabled("signBurnShares"),
  signUpdatePublicPool: () => disabled("signUpdatePublicPool"),
  signStakeAssets: () => disabled("signStakeAssets"),
  signUnstakeAssets: () => disabled("signUnstakeAssets"),
  getTransferTransaction: () => disabled("getTransferTransaction"),
  signTransfer: () => disabled("signTransfer"),
  getApproveIntegratorTransaction: () => disabled("getApproveIntegratorTransaction"),
  signApproveIntegrator: () => disabled("signApproveIntegrator"),
  signWithdraw: () => disabled("signWithdraw"),
  createClient: ({ seed, chainId, accountIndex, nonce, apiKeyIndex, skipNonce }) =>
    processWasmCall(
      window._createClient(seed, chainId, accountIndex, nonce, apiKeyIndex, skipNonce ?? false)
    ).then(processWasmError) as ReturnType<Signers["createClient"]>,
  createAuthToken: ({ accountIndex, apiKeyIndex }) =>
    waitForWasm().then(() =>
      processWasmCall(window._createAuthToken(accountIndex, apiKeyIndex)).then(processWasmError)
    ) as ReturnType<Signers["createAuthToken"]>,
  getChangePubKeyTransaction: ({ accountIndex, nonce, apiKeyIndex }) =>
    processWasmCall(window._getChangePubKeyTransaction(accountIndex, nonce, apiKeyIndex)).then(
      processWasmError
    ) as ReturnType<Signers["getChangePubKeyTransaction"]>,
  getRevokePubKeyTransaction: ({ accountIndex, nonce, apiKeyIndex }) =>
    processWasmCall(window._getRevokePubKeyTransaction(accountIndex, nonce, apiKeyIndex)).then(
      processWasmError
    ) as ReturnType<Signers["getRevokePubKeyTransaction"]>,
  signChangePubKey: ({ accountIndex, signature, nonce, apiKeyIndex }) =>
    processWasmCall(window._signChangePubKey(accountIndex, signature, nonce, apiKeyIndex)).then(
      processWasmError
    ) as ReturnType<Signers["signChangePubKey"]>,
  signRevokePubKey: ({ accountIndex, signature, nonce, apiKeyIndex }) =>
    processWasmCall(window._signRevokePubKey(accountIndex, signature, nonce, apiKeyIndex)).then(
      processWasmError
    ) as ReturnType<Signers["signRevokePubKey"]>,
  getAirdropAllocationMessage: () => disabled("getAirdropAllocationMessage"),
};
