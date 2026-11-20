/**
 * Which interest-rate strategy the market page may read for its curve (Codex r1 #2): only the
 * manifest's `reserveInterestRateStrategy`, and only while the reserve reports that same address.
 * A different reported address (e.g. governance switched strategies before the manifest was
 * updated) makes the curve unavailable; the unlisted address is never called.
 */
export function curveStrategy(
  manifestStrategy: `0x${string}` | null,
  reportedStrategy: `0x${string}` | undefined,
): `0x${string}` | null {
  if (!manifestStrategy || !reportedStrategy) return null;
  return manifestStrategy.toLowerCase() === reportedStrategy.toLowerCase() ? manifestStrategy : null;
}
