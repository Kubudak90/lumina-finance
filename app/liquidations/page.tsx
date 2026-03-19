"use client";

import { useState } from "react";
import { truncateAddress } from "@/lib/format";
import { LiquidateModal } from "@/components/actions/LiquidateModal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface LiquidationOpportunity {
  borrower: `0x${string}`;
  debt: string;
  collateral: string;
  healthFactor: string;
  debtAsset: `0x${string}`;
  collateralAdapter: `0x${string}`;
  maxDebt: string;
  debtSymbol: string;
}

export default function LiquidationsPage() {
  const [selected, setSelected] = useState<LiquidationOpportunity | null>(null);

  // MVP: placeholder -- in production, fetch from events/indexer
  const opportunities: LiquidationOpportunity[] = [];

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-3xl font-bold mb-1 text-foreground">Liquidation Opportunities</h1>
        <p className="text-muted-foreground">Positions below health factor 1.0 can be liquidated</p>
      </div>

      <Card className="p-0 animate-in-delay-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-6">Borrower</TableHead>
              <TableHead className="px-6">Debt</TableHead>
              <TableHead className="px-6">Collateral</TableHead>
              <TableHead className="px-6">Health Factor</TableHead>
              <TableHead className="px-6"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {opportunities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                  No liquidation opportunities at this time
                </TableCell>
              </TableRow>
            ) : (
              opportunities.map((o) => (
                <TableRow key={o.borrower}>
                  <TableCell className="px-6 py-4 font-mono text-sm">{truncateAddress(o.borrower)}</TableCell>
                  <TableCell className="px-6 py-4 font-mono">{o.debt}</TableCell>
                  <TableCell className="px-6 py-4 font-mono">{o.collateral}</TableCell>
                  <TableCell className="px-6 py-4">
                    <Badge variant="destructive" className="font-mono">
                      {o.healthFactor}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-6 py-4">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setSelected(o)}
                    >
                      Liquidate
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {selected && (
        <LiquidateModal
          borrower={selected.borrower}
          debtAsset={selected.debtAsset}
          debtSymbol={selected.debtSymbol}
          collateralAdapter={selected.collateralAdapter}
          maxDebt={selected.maxDebt}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
