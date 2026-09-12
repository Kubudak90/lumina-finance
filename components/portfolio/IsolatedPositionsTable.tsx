import { formatUnits } from "viem";
import type { UserIsolatedPosition } from "@/hooks/useUserIsolatedPositions";

function fmt(value: bigint, decimals: number): string {
  const n = Number(formatUnits(value, decimals));
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function IsolatedPositionsTable({ positions }: { positions: UserIsolatedPosition[] }) {
  if (positions.length === 0) {
    return <p className="text-sm text-muted-foreground">No isolated positions.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-text-dim">
          <th className="py-1">Pair</th>
          <th className="py-1">Lent</th>
          <th className="py-1">Borrowed</th>
          <th className="py-1">Collateral</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <tr key={position.pair} className="border-t border-border">
            <td className="py-1.5 font-mono">
              {position.assetSymbol}/{position.collateralSymbol}
            </td>
            <td className="py-1.5 font-mono">
              {fmt(position.suppliedAssets, position.assetDecimals)} {position.assetSymbol}
            </td>
            <td className="py-1.5 font-mono">
              {fmt(position.borrowedAssets, position.assetDecimals)} {position.assetSymbol}
            </td>
            <td className="py-1.5 font-mono">
              {fmt(position.collateralAmount, position.collateralDecimals)} {position.collateralSymbol}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
