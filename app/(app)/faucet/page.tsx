"use client";

import { useEffect, useRef } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { TokenIcon } from "@/components/common/TokenIcon";
import { ADDRESSES } from "@/lib/contracts";
import { TxButton } from "@/components/common/TxButton";
import { toast } from "sonner";
import { parseErrorMessage } from "@/lib/errorMessages";

const FAUCET_ABI = [
  {
    name: "drip",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "timeUntilNext",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "cooldown",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const FAUCET_TOKENS = [
  { symbol: "USDC", name: "USD Coin", description: "10,000 USDC" },
  { symbol: "LIT", name: "LIT Token", description: "5 LIT" },
];

function formatRemaining(secs: number): string {
  if (secs <= 0) return "Ready";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${secs % 60}s`;
  return `${secs}s`;
}

export default function FaucetPage() {
  const { address, isConnected } = useAccount();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const remaining = useReadContract({
    address: ADDRESSES.faucet,
    abi: FAUCET_ABI,
    functionName: "timeUntilNext",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const remainingSeconds = Number((remaining.data as bigint | undefined) ?? 0n);
  const onCooldown = remainingSeconds > 0;

  const prevErrorRef = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevErrorRef.current) {
      prevErrorRef.current = error;
      toast.error("Drip failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Tokens minted", {
        description: "10,000 USDC + 5 LIT sent to your wallet",
        action: { label: "View on Explorer", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
      remaining.refetch();
    }
  }, [isSuccess, hash]);

  const handleDrip = () => {
    if (!address) return;
    writeContract({
      address: ADDRESSES.faucet,
      abi: FAUCET_ABI,
      functionName: "drip",
    });
  };

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
        <div className="space-y-4 animate-in-delay-1">
          <div className="grid sm:grid-cols-2 gap-4">
            {FAUCET_TOKENS.map((token) => (
              <div key={token.symbol} className="technical-border bg-card p-4 flex items-center gap-4">
                <TokenIcon symbol={token.symbol} size={40} />
                <div>
                  <div className="font-bold text-foreground">{token.symbol}</div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{token.name}</div>
                  <div className="text-sm font-mono mt-1 text-foreground">{token.description}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="technical-border bg-card p-5 space-y-4">
            <div>
              <div className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Single drip — both tokens</div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">
                {onCooldown ? `Next available in ${formatRemaining(remainingSeconds)}` : "Ready to drip"}
              </div>
            </div>
            {isSuccess ? (
              <button
                className="w-full h-12 border border-accent/30 text-accent text-[10px] uppercase tracking-wider hover:bg-accent hover:text-background transition-colors"
                onClick={() => { reset(); remaining.refetch(); }}
              >
                Dripped! &mdash; reset
              </button>
            ) : (
              <TxButton
                onClick={handleDrip}
                isPending={isPending}
                isConfirming={isConfirming}
                disabled={!address || onCooldown}
              >
                {onCooldown ? "Cooldown active" : "Drip Tokens"}
              </TxButton>
            )}
          </div>
        </div>
      )}

      <div className="technical-border bg-card animate-in-delay-3">
        <div className="p-4 border-b border-border/50">
          <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">How to use</h2>
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-1">3 steps to start using Lumina Finance</p>
        </div>
        <div className="p-4">
          <ol className="list-decimal list-inside space-y-3 text-muted-foreground text-sm">
            <li><span className="text-foreground font-medium">Drip tokens</span> — Click Drip above to receive 10,000 USDC and 5 LIT (cooldown: 6 hours)</li>
            <li><span className="text-foreground font-medium">Supply</span> — Go to Markets, pick USDC or LIT, and supply tokens to earn yield</li>
            <li><span className="text-foreground font-medium">Borrow</span> — Supplied assets are auto-collateral. Borrow against them and watch your Health Factor</li>
          </ol>
        </div>
      </div>

      <div className="text-center text-[10px] font-mono uppercase tracking-wider text-muted-foreground animate-in-delay-4">
        <p>Need ETH for gas on Base Sepolia? Use the official Base Sepolia faucet</p>
      </div>
    </div>
  );
}
