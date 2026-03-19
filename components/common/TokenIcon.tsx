interface TokenIconProps {
  symbol: string;
  size?: number;
}

const COLORS: Record<string, string> = {
  USDC: "bg-blue-500",
  WETH: "bg-purple-500",
  ETH: "bg-purple-500",
};

export function TokenIcon({ symbol, size = 32 }: TokenIconProps) {
  return (
    <div
      className={`${COLORS[symbol] || "bg-slate-500"} rounded-full flex items-center justify-center text-white font-bold`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {symbol.slice(0, 2)}
    </div>
  );
}
