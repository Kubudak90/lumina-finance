"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { TxButton } from "@/components/common/TxButton";
import { useTokenApproval } from "@/hooks/useTokenApproval";
import { LENDING_POOL_ABI, ADDRESSES } from "@/lib/contracts";

interface LiquidateModalProps {
  borrower: `0x${string}`;
  debtAsset: `0x${string}`;
  debtSymbol: string;
  collateralAdapter: `0x${string}`;
  maxDebt: string;
  onClose: () => void;
}

export function LiquidateModal({
  borrower,
  debtAsset,
  debtSymbol,
  collateralAdapter,
  maxDebt,
  onClose,
}: LiquidateModalProps) {
  const [amount, setAmount] = useState("");
  const { address } = useAccount();
  const approval = useTokenApproval(debtAsset, ADDRESSES.lendingPool, address);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const parsedAmount = amount ? parseUnits(amount, 18) : 0n;

  const handleLiquidate = () => {
    if (approval.needsApproval(parsedAmount)) {
      approval.approve();
      return;
    }
    writeContract({
      address: ADDRESSES.lendingPool,
      abi: LENDING_POOL_ABI,
      functionName: "liquidate",
      args: [borrower, debtAsset, parsedAmount, collateralAdapter],
    });
  };

  if (isSuccess) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
        <div
          className="bg-brand-card border border-brand-border rounded-2xl p-6 w-full max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center">
            <div className="text-4xl mb-4">&#10003;</div>
            <h3 className="text-xl font-bold mb-2">Liquidation Successful</h3>
            <button onClick={onClose} className="text-brand-cyan hover:underline">
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-brand-card border border-brand-border rounded-2xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-bold">Liquidate Position</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            &#10005;
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4">
          Max repayable: {maxDebt} {debtSymbol} (50% close factor)
        </p>
        <div className="mb-6">
          <label className="text-sm text-slate-400 mb-2 block">Repay Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-brand-dark border border-brand-border rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:border-brand-cyan"
          />
        </div>
        <TxButton
          onClick={handleLiquidate}
          isPending={isPending || approval.isPending}
          isConfirming={isConfirming || approval.isConfirming}
          disabled={!amount || parsedAmount === 0n}
        >
          {approval.needsApproval(parsedAmount) ? `Approve ${debtSymbol}` : "Execute Liquidation"}
        </TxButton>
      </div>
    </div>
  );
}
