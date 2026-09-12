/** Basis-point denominator used for slippage haircuts (100% = 10_000). */
export const BPS_DENOMINATOR = 10_000n;

/** Swap deadline window. Long enough to confirm, short enough to limit stale quotes. */
export const DEFAULT_SWAP_DEADLINE_SECONDS = 5 * 60;

/** Aave V3 oracle prices are USD with 8 decimals. */
export const ORACLE_PRICE_DECIMALS = 8;

export const SLIPPAGE_OPTIONS = [
  { bps: 50, label: "0.5%" },
  { bps: 100, label: "1%" },
  { bps: 200, label: "2%" },
] as const;

export type SlippageBps = (typeof SLIPPAGE_OPTIONS)[number]["bps"];

export const DEFAULT_SLIPPAGE_BPS: SlippageBps = 100;

export function isAllowedSlippageBps(value: number): value is SlippageBps {
  return SLIPPAGE_OPTIONS.some((option) => option.bps === value);
}

/**
 * Convert an exact-in amount to an expected exact-out using USD prices
 * with `ORACLE_PRICE_DECIMALS` (Aave oracle 1e8). Returns 0 when any input
 * is missing or non-positive so callers can refuse to submit.
 */
export function quoteExactIn(
  amountIn: bigint,
  tokenInDecimals: number,
  tokenOutDecimals: number,
  priceIn: bigint,
  priceOut: bigint,
): bigint {
  if (
    amountIn <= 0n ||
    priceIn <= 0n ||
    priceOut <= 0n ||
    !Number.isInteger(tokenInDecimals) ||
    !Number.isInteger(tokenOutDecimals) ||
    tokenInDecimals < 0 ||
    tokenOutDecimals < 0 ||
    tokenInDecimals > 36 ||
    tokenOutDecimals > 36
  ) {
    return 0n;
  }

  const inScale = 10n ** BigInt(tokenInDecimals);
  const outScale = 10n ** BigInt(tokenOutDecimals);
  return (amountIn * priceIn * outScale) / (priceOut * inScale);
}

/**
 * Apply a slippage haircut in basis points. Invalid or out-of-range bps
 * fail closed to 0 so the UI cannot send an unprotected minAmountOut.
 */
export function applySlippage(quotedOut: bigint, slippageBps: number): bigint {
  if (quotedOut <= 0n) return 0n;
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= Number(BPS_DENOMINATOR)) {
    return 0n;
  }
  return (quotedOut * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
}

/** Oracle quote followed by a slippage haircut. Zero means "do not submit". */
export function minAmountOutFromQuote(
  amountIn: bigint,
  tokenInDecimals: number,
  tokenOutDecimals: number,
  priceIn: bigint | undefined,
  priceOut: bigint | undefined,
  slippageBps: number,
): bigint {
  if (priceIn === undefined || priceOut === undefined) return 0n;
  return applySlippage(
    quoteExactIn(amountIn, tokenInDecimals, tokenOutDecimals, priceIn, priceOut),
    slippageBps,
  );
}

export function swapDeadline(
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = DEFAULT_SWAP_DEADLINE_SECONDS,
): bigint {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("deadline ttl must be a positive integer");
  }
  return BigInt(nowSeconds + ttlSeconds);
}
