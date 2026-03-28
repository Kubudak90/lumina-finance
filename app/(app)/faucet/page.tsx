"use client";

import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
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
    decimals: 6,
    description: "10,000 USDC",
  },
  {
    symbol: "LIT",
    name: "LIT Token",
    address: ADDRESSES.lit,
    amount: "5",
    decimals: 18,
    description: "5 LIT",
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
    <div className="technical-border bg-card">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <TokenIcon symbol={token.symbol} size={40} />
          <div>
            <div className="font-bold text-foreground">{token.symbol}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{token.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-mono font-bold text-foreground">{token.description}</div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">per request</div>
          </div>
          {isSuccess ? (
            <button
              className="w-32 h-10 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-colors"
              onClick={() => reset()}
            >
              Minted!
            </button>
          ) : (
            <button
              className="w-32 h-10 bg-accent text-background font-bold uppercase tracking-[0.2em] text-[10px] hover:bg-white shadow-[0_0_20px_rgba(176,196,255,0.2)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={handleMint}
              disabled={!address || isPending || isConfirming}
            >
              {isPending ? "Confirm..." : isConfirming ? "Minting..." : "Mint"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FaucetPage() {
  const { isConnected } = useAccount();

  return (
    <div className="space-y-8">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">Faucet</h1>
        <p className="text-muted-foreground text-sm">Get test tokens to try Lumina Finance on Base Sepolia</p>
      </div>

      {!isConnected ? (
        <div className="technical-border bg-card animate-in-delay-1">
          <div className="py-12 text-center">
            <p className="text-muted-foreground">Connect your wallet to use the faucet</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {FAUCET_TOKENS.map((token, i) => (
            <div key={token.symbol} className={`animate-in-delay-${i + 1}`}>
              <FaucetCard token={token} />
            </div>
          ))}
        </div>
      )}

      <div className="technical-border bg-card animate-in-delay-3">
        <div className="p-4 border-b border-border/50">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">How to use</h2>
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">3 steps to start using Lumina Finance</p>
        </div>
        <div className="p-4">
          <ol className="list-decimal list-inside space-y-3 text-muted-foreground text-sm">
            <li><span className="text-foreground font-medium">Mint tokens</span> — Click Mint above to get test USDC and LIT</li>
            <li><span className="text-foreground font-medium">Supply</span> — Go to Markets, pick USDC or LIT, and supply tokens to earn yield</li>
            <li><span className="text-foreground font-medium">Borrow</span> — Enable collateral, then borrow against it. Watch your Health Factor!</li>
          </ol>
        </div>
      </div>

      <div className="text-center text-[10px] font-mono uppercase tracking-wider text-muted-foreground animate-in-delay-4">
        <p>Need ETH for gas on Base Sepolia? Use the official Base Sepolia faucet</p>
      </div>
    </div>
  );
}
