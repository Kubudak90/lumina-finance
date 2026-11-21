/**
 * RPC chain verification (Codex r1 #1). The configured RPC must answer `eth_chainId` with the
 * Lumina chain before any other request goes through it: a misconfigured URL (another chain's RPC)
 * then fails every read and simulation instead of quietly serving another chain's state.
 */
import type { EIP1193RequestFn, Transport } from "viem";

export class RpcChainMismatchError extends Error {
  readonly expected: number;
  readonly actual: number | null;
  constructor(expected: number, actual: number | null) {
    super(
      actual === null
        ? `RPC chain id unreadable; expected ${expected}`
        : `RPC is on chain ${actual}; expected ${expected}`,
    );
    this.name = "RpcChainMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

/** eth_chainId result (hex quantity) → number, or null if malformed. */
export function parseChainId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isSafeInteger(raw)) return raw;
  if (typeof raw === "string" && /^0x[0-9a-fA-F]+$/.test(raw)) {
    const n = Number.parseInt(raw, 16);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** A successful verification is trusted for this long, then re-checked on the next request. */
export const RPC_VERIFY_TTL_MS = 60_000;

/**
 * Wrap a transport so every request except `eth_chainId` first verifies the RPC's chain id.
 * - A successful check is cached for `ttlMs`; a mismatch or a failure is not, so the next request
 *   checks again (a transient error recovers, a wrong RPC keeps failing).
 * - Any pass-through `eth_chainId` (e.g. the UI's periodic status poll) that reports another chain
 *   or fails drops the cached verification at once (Gemini r2 m1).
 */
export function chainCheckedTransport(
  inner: Transport,
  expectedChainId: number,
  options: { ttlMs?: number; now?: () => number } = {},
): Transport {
  const ttlMs = options.ttlMs ?? RPC_VERIFY_TTL_MS;
  const now = options.now ?? (() => Date.now());
  return (params) => {
    const base = inner(params);
    let verified: Promise<void> | null = null;
    let verifiedAt = 0;

    const invalidate = () => {
      verified = null;
      verifiedAt = 0;
    };

    const verify = (): Promise<void> => {
      if (verified && verifiedAt > 0 && now() - verifiedAt > ttlMs) invalidate();
      if (!verified) {
        const attempt = (async () => {
          const id = parseChainId(await base.request({ method: "eth_chainId" }));
          if (id !== expectedChainId) throw new RpcChainMismatchError(expectedChainId, id);
          verifiedAt = now();
        })();
        verified = attempt;
        attempt.catch(() => {
          if (verified === attempt) invalidate();
        });
      }
      return verified;
    };

    const request = (async (args, opts) => {
      if (args.method === "eth_chainId") {
        try {
          const raw = await base.request(args, opts);
          if (parseChainId(raw) !== expectedChainId) invalidate();
          return raw;
        } catch (err) {
          invalidate();
          throw err;
        }
      }
      await verify();
      return base.request(args, opts);
    }) as EIP1193RequestFn;

    return { ...base, request };
  };
}
