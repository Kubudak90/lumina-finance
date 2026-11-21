import { TokenIcon } from "@/components/common/TokenIcon";

/**
 * A token icon in a fixed-size box. Tailwind's preflight gives every <img> `max-width: 100%`, and
 * a replaced element with a percentage max-width counts as 0 px when a table sizes its columns, so
 * a bare icon makes its cell too narrow and the text next to it spills into the next column. The
 * wrapper is not a replaced element: it always counts its full width.
 */
export function FixedTokenIcon({ symbol, size }: { symbol: string; size: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <TokenIcon symbol={symbol} size={size} />
    </span>
  );
}

/** "ASSET / COLLATERAL" icons for an isolated pair, at a fixed width. */
export function PairIcons({ asset, collateral, size = 18 }: { asset: string; collateral: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <FixedTokenIcon symbol={asset} size={size} />
      <span className="text-muted-foreground text-xs">/</span>
      <FixedTokenIcon symbol={collateral} size={size} />
    </span>
  );
}
