"use client";

import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TokenIcon } from "@/components/common/TokenIcon";
import { ADDRESSES } from "@/lib/contracts";

const MINT_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const FAUCET_TOKENS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: ADDRESSES.usdc,
    amount: "10000",
    decimals: 18,
    description: "10,000 USDC",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: ADDRESSES.weth,
    amount: "5",
    decimals: 18,
    description: "5 WETH",
  },
];

function FaucetCard({
  token,
}: {
  token: (typeof FAUCET_TOKENS)[number];
}) {
  const { address } = useAccount();
  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const handleMint = () => {
    if (!address) return;
    writeContract({
      address: token.address,
      abi: MINT_ABI,
      functionName: "mint",
      args: [address, parseUnits(token.amount, token.decimals)],
    });
  };

  return (
    <Card>
      <CardContent className="flex items-center justify-between py-2">
        <div className="flex items-center gap-4">
          <TokenIcon symbol={token.symbol} size={40} />
          <div>
            <div className="font-semibold text-foreground text-lg">{token.symbol}</div>
            <div className="text-sm text-muted-foreground">{token.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-mono font-bold text-foreground">{token.description}</div>
            <div className="text-xs text-muted-foreground">per request</div>
          </div>
          {isSuccess ? (
            <Button variant="outline" size="lg" className="w-32" onClick={() => reset()}>
              Minted!
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-32"
              onClick={handleMint}
              disabled={!address || isPending || isConfirming}
            >
              {isPending ? "Confirm..." : isConfirming ? "Minting..." : "Mint"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function FaucetPage() {
  const { isConnected } = useAccount();

  return (
    <div className="space-y-8">
      <div className="animate-in">
        <h1 className="text-3xl font-bold mb-1 text-foreground">Faucet</h1>
        <p className="text-muted-foreground">Get test tokens to try LightLend on Base Sepolia</p>
      </div>

      {!isConnected ? (
        <Card className="animate-in-delay-1">
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-lg">Connect your wallet to use the faucet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {FAUCET_TOKENS.map((token, i) => (
            <div key={token.symbol} className={`animate-in-delay-${i + 1}`}>
              <FaucetCard token={token} />
            </div>
          ))}
        </div>
      )}

      <Card className="animate-in-delay-3">
        <CardHeader>
          <CardTitle>How to use</CardTitle>
          <CardDescription>3 steps to start testing LightLend</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-3 text-muted-foreground">
            <li><span className="text-foreground font-medium">Mint tokens</span> — Click Mint above to get test USDC and WETH</li>
            <li><span className="text-foreground font-medium">Supply</span> — Go to Markets, pick USDC or WETH, and supply tokens to earn yield</li>
            <li><span className="text-foreground font-medium">Borrow</span> — Enable collateral, then borrow against it. Watch your Health Factor!</li>
          </ol>
        </CardContent>
      </Card>

      <div className="text-center text-sm text-muted-foreground animate-in-delay-4">
        <p>Need Base Sepolia ETH for gas? Use the <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noopener noreferrer" className="text-brand-accent hover:underline">Alchemy Faucet</a></p>
      </div>
    </div>
  );
}
