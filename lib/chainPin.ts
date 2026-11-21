/**
 * Chain pinning (FE-03). Every read and write names its chain explicitly; a write is refused
 * unless the wallet, the simulating client and the request all agree on the expected chain.
 *
 * Pure functions, so the guarantees are unit-tested; the wagmi wrappers in `hooks/chain/` only
 * call into these.
 */

export class ChainMismatchError extends Error {
  readonly expected: number;
  readonly actual: number | undefined;
  constructor(expected: number, actual: number | undefined, what = "wallet") {
    super(
      actual === undefined
        ? `${what} chain unknown; expected chain ${expected}`
        : `${what} is on chain ${actual}; expected chain ${expected}`,
    );
    this.name = "ChainMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export class MissingChainIdError extends Error {
  constructor() {
    super("write attempted without a chainId");
    this.name = "MissingChainIdError";
  }
}

/** Throws unless the wallet is connected to `expected`. */
export function assertWalletChain(expected: number, walletChainId: number | undefined): void {
  if (walletChainId !== expected) throw new ChainMismatchError(expected, walletChainId, "wallet");
}

/**
 * Return `params` with `chainId` set to `chainId`. Throws if `params` already names another chain,
 * so a caller can never silently override the pin.
 */
export function pinChainId<T extends object>(params: T, chainId: number): T & { chainId: number } {
  const existing = (params as { chainId?: unknown }).chainId;
  if (existing !== undefined && existing !== chainId) {
    throw new ChainMismatchError(chainId, typeof existing === "number" ? existing : undefined, "request");
  }
  return { ...params, chainId };
}

/** Pin every entry of a `useReadContracts` contract list. */
export function pinContracts<T extends object>(contracts: readonly T[], chainId: number): (T & { chainId: number })[] {
  return contracts.map((c) => pinChainId(c, chainId));
}

/** Throws unless `request.chainId === expected` (the last check before a wallet prompt). */
export function assertPinned(request: { chainId?: number }, expected: number): void {
  if (request.chainId === undefined) throw new MissingChainIdError();
  if (request.chainId !== expected) throw new ChainMismatchError(expected, request.chainId, "request");
}

export interface WriteRequest {
  address: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  chainId?: number;
}

export interface PinnedWriteDeps<Simulated extends object, Result> {
  request: WriteRequest;
  account: `0x${string}` | undefined;
  expectedChainId: number;
  /** Chain the wallet is connected to right now. */
  walletChainId: number | undefined;
  /** Chain of the public client used for simulation. */
  simulatorChainId: number | undefined;
  /** Chain id the configured RPC actually reported (eth_chainId). */
  rpcChainId: number | undefined;
  simulate: (params: WriteRequest & { account: `0x${string}`; chainId: number }) => Promise<{ request: Simulated }>;
  write: (params: Simulated & { chainId: number }) => Promise<Result>;
}

/**
 * Validate → simulate on the pinned chain → send with `chainId`, so wagmi also asserts the wallet
 * chain at signing time. Throws before any wallet prompt if the wallet, the RPC (eth_chainId), the
 * simulating client or the request is on another chain.
 */
export async function executePinnedWrite<Simulated extends object, Result>(
  deps: PinnedWriteDeps<Simulated, Result>,
): Promise<Result> {
  const { request, account, expectedChainId, walletChainId, simulatorChainId, rpcChainId, simulate, write } = deps;
  if (!account) throw new Error("Wallet not connected");
  assertWalletChain(expectedChainId, walletChainId);
  if (rpcChainId !== expectedChainId) throw new ChainMismatchError(expectedChainId, rpcChainId, "RPC");
  if (simulatorChainId !== expectedChainId) {
    throw new ChainMismatchError(expectedChainId, simulatorChainId, "RPC client");
  }
  const pinned = pinChainId({ ...request, account }, expectedChainId);
  const simulated = await simulate(pinned);
  const send = pinChainId(simulated.request, expectedChainId);
  assertPinned(send, expectedChainId);
  return write(send);
}
