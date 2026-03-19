"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { TxButton } from "@/components/common/TxButton";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { LENDING_POOL_ABI, ADDRESSES } from "@/lib/contracts";

interface SupplyModalProps {
  asset: `0x${string}`;
  symbol: string;
  decimals: number;
  onClose: () => void;
}

export function SupplyModal({ asset, symbol, decimals, onClose }: SupplyModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const approval = useTokenApproval(asset, ADDRESSES.lendingPool, address);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsedAmount = amount ? parseUnits(amount, decimals) : 0n;

  const handleSupply = () => {
    if (approval.needsApproval(parsedAmount)) {
      approval.approve();
      return;
    }
    writeContract({
      address: ADDRESSES.lendingPool,
      abi: LENDING_POOL_ABI,
      functionName: "supply",
      args: [asset, parsedAmount],
    });
  };

  if (isSuccess) {
    return (
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white border border-brand-border rounded-2xl p-6 w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
          <div className="text-center">
            <div className="text-4xl mb-4 text-success">&#10003;</div>
            <h3 className="text-xl font-bold mb-2 text-text-primary">Supply Successful</h3>
            <p className="text-text-secondary mb-4">You supplied {amount} {symbol}</p>
            <button onClick={onClose} className="text-brand-accent hover:underline font-medium">Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white border border-brand-border rounded-2xl p-6 w-full max-w-md shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold text-text-primary">Supply {symbol}</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">&#10005;</button>
        </div>
        <div className="mb-6">
          <label className="text-sm text-text-secondary mb-2 block">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-white border border-brand-border rounded-lg px-4 py-3 text-lg font-mono text-text-primary focus:outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent/20 transition-colors"
          />
        </div>
        <TxButton
          onClick={handleSupply}
          isPending={isPending || approval.isPending}
          isConfirming={isConfirming || approval.isConfirming}
          disabled={!amount || parsedAmount === 0n}
        >
          {approval.needsApproval(parsedAmount) ? `Approve ${symbol}` : `Supply ${symbol}`}
        </TxButton>
      </div>
    </div>
  );
}
