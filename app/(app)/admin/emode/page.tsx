"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { ADDRESSES } from "@/lib/contracts";
import { POOL_ABI, POOL_CONFIGURATOR_ABI, ACL_MANAGER_ABI } from "@/lib/abis";
import { MARKETS } from "@/lib/constants";
import { parseErrorMessage } from "@/lib/errorMessages";

const CATEGORY_IDS = [1, 2, 3, 4, 5] as const;

interface CategoryRow {
  id: number;
  ltv: number;
  liqThreshold: number;
  liqBonus: number;
  label: string;
  exists: boolean;
}

function pctToBps(input: string): number {
  const num = Number(input);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.round(num * 100);
}

function bpsToPct(bps: number): string {
  return (bps / 100).toFixed(2);
}

export default function EModeAdminPage() {
  const { address, isConnected } = useAccount();

  const isPoolAdmin = useReadContract({
    address: ADDRESSES.aclManager,
    abi: ACL_MANAGER_ABI,
    functionName: "isPoolAdmin",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const isRiskAdmin = useReadContract({
    address: ADDRESSES.aclManager,
    abi: ACL_MANAGER_ABI,
    functionName: "isRiskAdmin",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const authorized = isPoolAdmin.data === true || isRiskAdmin.data === true;

  // Read existing categories
  const categoryReads = useReadContracts({
    contracts: CATEGORY_IDS.map((id) => ({
      address: ADDRESSES.pool,
      abi: POOL_ABI,
      functionName: "getEModeCategoryData" as const,
      args: [id] as const,
    })),
    query: { refetchInterval: 30_000 },
  });

  const categories: CategoryRow[] = CATEGORY_IDS.map((id, i) => {
    const raw = categoryReads.data?.[i]?.result;
    let row: CategoryRow = { id, ltv: 0, liqThreshold: 0, liqBonus: 0, label: "", exists: false };
    if (!raw) return row;
    if (Array.isArray(raw)) {
      row = {
        id,
        ltv: Number(raw[0] ?? 0),
        liqThreshold: Number(raw[1] ?? 0),
        liqBonus: Number(raw[2] ?? 0),
        label: (raw[4] as string) ?? "",
        exists: Number(raw[1] ?? 0) > 0,
      };
    } else if (typeof raw === "object") {
      const d = raw as Record<string, unknown>;
      row = {
        id,
        ltv: Number(d.ltv ?? 0),
        liqThreshold: Number(d.liquidationThreshold ?? 0),
        liqBonus: Number(d.liquidationBonus ?? 0),
        label: (d.label as string) ?? "",
        exists: Number(d.liquidationThreshold ?? 0) > 0,
      };
    }
    return row;
  });

  // ─── Define / Update Category ───
  const [defForm, setDefForm] = useState({ id: "1", ltvPct: "97", liqThresholdPct: "97.5", liqBonusPct: "1", label: "Stablecoins" });
  const setDef = <K extends keyof typeof defForm>(k: K, v: string) => setDefForm((s) => ({ ...s, [k]: v }));

  const defTx = useWriteContract();
  const defReceipt = useWaitForTransactionReceipt({ hash: defTx.data });
  const prevDefErr = useRef<Error | null>(null);
  useEffect(() => {
    if (defTx.error && defTx.error !== prevDefErr.current) {
      prevDefErr.current = defTx.error;
      toast.error("Set category failed", { description: parseErrorMessage(defTx.error) });
    }
  }, [defTx.error]);
  useEffect(() => {
    if (defReceipt.isSuccess) toast.success(`Category ${defForm.id} updated`);
  }, [defReceipt.isSuccess, defForm.id]);

  const handleDefine = () => {
    const id = Number(defForm.id);
    if (id < 1 || id > 255) return;
    const ltv = pctToBps(defForm.ltvPct);
    const liq = pctToBps(defForm.liqThresholdPct);
    // Aave: liquidationBonus must be > 100% (10000 bps), e.g. 1% bonus → 10100
    const bonus = 10000 + pctToBps(defForm.liqBonusPct);
    if (ltv > liq || liq > 10000) {
      toast.error("Invalid params", { description: "ltv ≤ liqThreshold ≤ 100%" });
      return;
    }
    defTx.writeContract({
      address: ADDRESSES.poolConfigurator,
      abi: POOL_CONFIGURATOR_ABI,
      functionName: "setEModeCategory",
      args: [id, ltv, liq, bonus, defForm.label],
    });
  };

  // ─── Asset toggles ───
  const [toggleForm, setToggleForm] = useState<{ asset: string; categoryId: string; asCollateral: boolean; asBorrowable: boolean }>({
    asset: MARKETS[0]?.asset ?? "",
    categoryId: "1",
    asCollateral: true,
    asBorrowable: true,
  });

  const collateralTx = useWriteContract();
  const collateralReceipt = useWaitForTransactionReceipt({ hash: collateralTx.data });
  const borrowableTx = useWriteContract();
  const borrowableReceipt = useWaitForTransactionReceipt({ hash: borrowableTx.data });

  useEffect(() => {
    if (collateralReceipt.isSuccess) toast.success("Asset collateral flag updated");
  }, [collateralReceipt.isSuccess]);
  useEffect(() => {
    if (borrowableReceipt.isSuccess) toast.success("Asset borrowable flag updated");
  }, [borrowableReceipt.isSuccess]);

  const setCollateral = (allowed: boolean) => {
    if (!toggleForm.asset) return;
    collateralTx.writeContract({
      address: ADDRESSES.poolConfigurator,
      abi: POOL_CONFIGURATOR_ABI,
      functionName: "setAssetCollateralInEMode",
      args: [toggleForm.asset as `0x${string}`, Number(toggleForm.categoryId), allowed],
    });
  };
  const setBorrowable = (borrowable: boolean) => {
    if (!toggleForm.asset) return;
    borrowableTx.writeContract({
      address: ADDRESSES.poolConfigurator,
      abi: POOL_CONFIGURATOR_ABI,
      functionName: "setAssetBorrowableInEMode",
      args: [toggleForm.asset as `0x${string}`, Number(toggleForm.categoryId), borrowable],
    });
  };

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">E-Mode Categories</h1>
        <p className="text-muted-foreground text-sm">Admin: define categories and assign assets</p>
      </div>

      {!isConnected ? (
        <div className="technical-border bg-card animate-in-delay-1 py-12 text-center text-muted-foreground">
          Connect your wallet to use this page
        </div>
      ) : !authorized ? (
        <div className="technical-border bg-amber-500/10 border-amber-500/30 p-4 animate-in-delay-1">
          <p className="text-sm text-amber-400 font-medium">Not authorized</p>
          <p className="text-xs text-muted-foreground mt-1">
            Connected wallet must be PoolAdmin or RiskAdmin in the ACL Manager (
            <span className="font-mono">{ADDRESSES.aclManager.slice(0, 10)}…</span>).
          </p>
        </div>
      ) : (
        <>
          {/* Existing categories */}
          <div className="technical-border bg-card animate-in-delay-1">
            <div className="p-4 border-b border-border/50">
              <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Categories 1–5</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">ID</th>
                  <th className="text-left text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Label</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">LTV</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Liq Threshold</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Liq Bonus</th>
                  <th className="text-right text-[10px] text-muted-foreground uppercase font-mono tracking-wider px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="px-6 py-3 font-mono text-sm">{c.id}</td>
                    <td className="px-6 py-3 font-mono text-sm">{c.label || "—"}</td>
                    <td className="px-6 py-3 font-mono text-sm text-right">{c.exists ? `${bpsToPct(c.ltv)}%` : "—"}</td>
                    <td className="px-6 py-3 font-mono text-sm text-right">{c.exists ? `${bpsToPct(c.liqThreshold)}%` : "—"}</td>
                    <td className="px-6 py-3 font-mono text-sm text-right">{c.exists ? `${(c.liqBonus / 100 - 100).toFixed(2)}%` : "—"}</td>
                    <td className="px-6 py-3 text-right">
                      <span className={`text-xs font-mono ${c.exists ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {c.exists ? "ACTIVE" : "empty"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Define / update */}
          <div className="technical-border bg-card animate-in-delay-2 p-6 space-y-4">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Define / Update Category</h2>
            <div className="grid sm:grid-cols-3 gap-3">
              <FieldNumber label="Category ID (1–255)" value={defForm.id} onChange={(v) => setDef("id", v)} />
              <FieldText label="Label" value={defForm.label} onChange={(v) => setDef("label", v)} />
              <FieldNumber label="LTV %" value={defForm.ltvPct} onChange={(v) => setDef("ltvPct", v)} />
              <FieldNumber label="Liq Threshold %" value={defForm.liqThresholdPct} onChange={(v) => setDef("liqThresholdPct", v)} />
              <FieldNumber label="Liq Bonus %" value={defForm.liqBonusPct} onChange={(v) => setDef("liqBonusPct", v)} />
            </div>
            <TxButton
              onClick={handleDefine}
              isPending={defTx.isPending}
              isConfirming={defReceipt.isLoading}
              disabled={false}
            >
              Set Category {defForm.id}
            </TxButton>
          </div>

          {/* Asset toggles */}
          <div className="technical-border bg-card animate-in-delay-3 p-6 space-y-4">
            <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent">Assign Assets to Category</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Asset</span>
                <select
                  value={toggleForm.asset}
                  onChange={(e) => setToggleForm({ ...toggleForm, asset: e.target.value })}
                  className="mt-1 w-full h-10 px-3 text-sm font-mono bg-background border border-border text-foreground focus:border-accent/50 focus:outline-none"
                >
                  {MARKETS.map((m) => (
                    <option key={m.asset} value={m.asset} className="bg-background">{m.symbol} — {m.asset.slice(0, 10)}…</option>
                  ))}
                </select>
              </label>
              <FieldNumber label="Category ID" value={toggleForm.categoryId} onChange={(v) => setToggleForm({ ...toggleForm, categoryId: v })} />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Use as collateral in this category</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCollateral(true)}
                    disabled={collateralTx.isPending || collateralReceipt.isLoading}
                    className="flex-1 h-9 border border-emerald-500/30 text-emerald-400 text-[10px] uppercase tracking-wider hover:bg-emerald-500 hover:text-background transition-all font-mono disabled:opacity-50"
                  >
                    {collateralTx.isPending ? "Confirm…" : collateralReceipt.isLoading ? "Confirming…" : "Allow"}
                  </button>
                  <button
                    onClick={() => setCollateral(false)}
                    disabled={collateralTx.isPending || collateralReceipt.isLoading}
                    className="flex-1 h-9 border border-rose-500/30 text-rose-400 text-[10px] uppercase tracking-wider hover:bg-rose-500 hover:text-background transition-all font-mono disabled:opacity-50"
                  >
                    Disallow
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Borrowable in this category</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBorrowable(true)}
                    disabled={borrowableTx.isPending || borrowableReceipt.isLoading}
                    className="flex-1 h-9 border border-emerald-500/30 text-emerald-400 text-[10px] uppercase tracking-wider hover:bg-emerald-500 hover:text-background transition-all font-mono disabled:opacity-50"
                  >
                    {borrowableTx.isPending ? "Confirm…" : borrowableReceipt.isLoading ? "Confirming…" : "Allow"}
                  </button>
                  <button
                    onClick={() => setBorrowable(false)}
                    disabled={borrowableTx.isPending || borrowableReceipt.isLoading}
                    className="flex-1 h-9 border border-rose-500/30 text-rose-400 text-[10px] uppercase tracking-wider hover:bg-rose-500 hover:text-background transition-all font-mono disabled:opacity-50"
                  >
                    Disallow
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FieldText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-10 px-3 text-sm bg-background border border-border text-foreground focus:border-accent/50 focus:outline-none transition-colors"
      />
    </label>
  );
}

function FieldNumber({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void; }) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min="0"
        step="any"
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full h-10 px-3 text-sm font-mono bg-background border border-border text-foreground focus:border-accent/50 focus:outline-none transition-colors"
      />
    </label>
  );
}
