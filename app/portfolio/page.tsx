"use client";

import { useAccount } from "wagmi";
import { HealthFactorBar } from "@/components/common/HealthFactorBar";
import { SupplyTable } from "@/components/portfolio/SupplyTable";
import { BorrowTable } from "@/components/portfolio/BorrowTable";
import { CollateralTable } from "@/components/portfolio/CollateralTable";
import { useHealthFactor } from "@/hooks/useHealthFactor";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function PortfolioPage() {
  const { isConnected } = useAccount();
  const { healthFactor } = useHealthFactor();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <h1 className="text-3xl font-bold mb-4 text-foreground">Portfolio</h1>
        <p className="text-muted-foreground mb-6">Connect your wallet to view your positions</p>
      </div>
    );
  }

  // MVP: placeholder data -- will be populated when contracts are deployed
  const supplies: { symbol: string; balance: string; value: string; apy: string }[] = [];
  const borrows: { symbol: string; debt: string; value: string; apy: string }[] = [];
  const collateral: { symbol: string; amount: string; value: string; ltv: string }[] = [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between animate-in">
        <h1 className="text-3xl font-bold text-foreground">Portfolio</h1>
        {healthFactor && (
          <div className="w-64">
            <HealthFactorBar healthFactor={healthFactor} />
          </div>
        )}
      </div>

      <Card className="animate-in-delay-1">
        <CardHeader>
          <CardTitle>Your Supplies</CardTitle>
        </CardHeader>
        <CardContent>
          <SupplyTable rows={supplies} onWithdraw={(s) => console.log("withdraw", s)} />
        </CardContent>
      </Card>

      <Card className="animate-in-delay-2">
        <CardHeader>
          <CardTitle>Your Borrows</CardTitle>
        </CardHeader>
        <CardContent>
          <BorrowTable rows={borrows} onRepay={(s) => console.log("repay", s)} />
        </CardContent>
      </Card>

      <Card className="animate-in-delay-3">
        <CardHeader>
          <CardTitle>Your Collateral</CardTitle>
        </CardHeader>
        <CardContent>
          <CollateralTable rows={collateral} />
        </CardContent>
      </Card>
    </div>
  );
}
