"use client";

import { useAccount } from "wagmi";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { SupplyTable } from "@/components/portfolio/SupplyTable";
import { BorrowTable } from "@/components/portfolio/BorrowTable";
import { CollateralTable } from "@/components/portfolio/CollateralTable";
import { useHealthFactor } from "@/hooks/useHealthFactor";

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const { healthFactor } = useHealthFactor();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <h1 className="text-3xl font-bold mb-4">Portfolio</h1>
        <p className="text-slate-400 mb-6">Connect your wallet to view your positions</p>
      </div>
    );
  }

  // MVP: placeholder data — will be populated when contracts are deployed
  const supplies: { symbol: string; balance: string; value: string; apy: string }[] = [];
  const borrows: { symbol: string; debt: string; value: string; apy: string }[] = [];
  const collateral: { symbol: string; amount: string; value: string; ltv: string }[] = [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Portfolio</h1>
        {healthFactor && (
          <div className="w-64">
            <HealthFactorBar healthFactor={healthFactor} />
          </div>
        )}
      </div>

      <div className="bg-brand-card border border-brand-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Your Supplies</h2>
        <SupplyTable rows={supplies} onWithdraw={(s) => console.log("withdraw", s)} />
      </div>

      <div className="bg-brand-card border border-brand-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Your Borrows</h2>
        <BorrowTable rows={borrows} onRepay={(s) => console.log("repay", s)} />
      </div>

      <div className="bg-brand-card border border-brand-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Your Collateral</h2>
        <CollateralTable rows={collateral} />
      </div>
    </div>
  );
}
