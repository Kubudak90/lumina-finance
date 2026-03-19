interface TokenIconProps {
  symbol: string;
  size?: number;
}

const GRADIENTS: Record<string, string> = {
  USDC: "from-blue-400 to-blue-600",
  WETH: "from-indigo-400 to-purple-600",
  ETH: "from-indigo-400 to-purple-600",
};

export function TokenIcon({ symbol, size = 32 }: TokenIconProps) {
  return (
    <div
      className={`bg-gradient-to-br ${GRADIENTS[symbol] || "from-gray-400 to-gray-600"} rounded-full flex items-center justify-center text-white font-bold shadow-sm`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {symbol.slice(0, 2)}
    </div>
  );
}
