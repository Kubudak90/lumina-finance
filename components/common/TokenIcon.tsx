import Image from "next/image";

interface TokenIconProps {
  symbol: string;
  size?: number;
}

const ICON_MAP: Record<string, string> = {
  USDC: "/tokens/usdc.svg",
  WETH: "/tokens/eth.svg",
  ETH: "/tokens/eth.svg",
};

export function TokenIcon({ symbol, size = 32 }: TokenIconProps) {
  const src = ICON_MAP[symbol];
  if (src) {
    return <Image src={src} alt={symbol} width={size} height={size} className="rounded-full" />;
  }
  return (
    <div
      className="rounded-full bg-muted flex items-center justify-center text-muted-foreground font-bold"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {symbol.slice(0, 2)}
    </div>
  );
}
