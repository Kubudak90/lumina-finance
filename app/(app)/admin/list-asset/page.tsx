"use client";

import { useEffect, useRef, useState } from "react";
import { isAddress } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { ADDRESSES } from "@/lib/contracts";
import { ASSET_LISTING_PROXY_ABI } from "@/lib/abis";
import { parseErrorMessage } from "@/lib/errorMessages";

const ENABLED = 1n;
const DISABLED = 0n;

interface FormState {
  asset: string;
  assetSymbol: string;
  priceFeed: string;
  ltvPct: string;
  liqThresholdPct: string;
  liqBonusPct: string;
  reserveFactorPct: string;
  liqProtocolFeePct: string;
  supplyCap: string;
  borrowCap: string;
  optimalUsagePct: string;
  baseRatePct: string;
  slope1Pct: string;
  slope2Pct: string;
  enabledToBorrow: boolean;
  flashloanable: boolean;
  enabledAsCollateral: boolean;
}

const DEFAULTS: FormState = {
  asset: "",
  assetSymbol: "",
  priceFeed: "",
  ltvPct: "75",
  liqThresholdPct: "80",
  liqBonusPct: "5",
  reserveFactorPct: "10",
  liqProtocolFeePct: "10",
  supplyCap: "1000000",
  borrowCap: "500000",
  optimalUsagePct: "80",
  baseRatePct: "0",
  slope1Pct: "4",
  slope2Pct: "75",
  enabledToBorrow: true,
  flashloanable: true,
  enabledAsCollateral: true,
};

const NETWORK_CONTEXT = { networkName: "Base Sepolia", networkAbbreviation: "BaseSep" } as const;

function pctToBps(input: string): bigint {
  const num = Number(input);
  if (!Number.isFinite(num) || num < 0) return 0n;
  return BigInt(Math.round(num * 100));
}

export default function ListAssetPage() {
  const { address, isConnected } = useAccount();
  const [form, setForm] = useState<FormState>(DEFAULTS);

  const owner = useReadContract({
    address: ADDRESSES.assetListingProxy,
    abi: ASSET_LISTING_PROXY_ABI,
    functionName: "owner",
  });
  const isOwner = !!address && (owner.data as `0x${string}` | undefined)?.toLowerCase() === address.toLowerCase();

  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const prevError = useRef<Error | null>(null);
  useEffect(() => {
    if (error && error !== prevError.current) {
      prevError.current = error;
      toast.error("Listing failed", { description: parseErrorMessage(error) });
    }
  }, [error]);

  useEffect(() => {
    if (isSuccess && hash) {
      toast.success("Asset listed", {
        description: `${form.assetSymbol} added to the pool`,
        action: { label: "View", onClick: () => window.open(`https://sepolia.basescan.org/tx/${hash}`, "_blank") },
      });
    }
  }, [isSuccess, hash, form.assetSymbol]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((s) => ({ ...s, [k]: v }));

  const validAsset = isAddress(form.asset);
  const validFeed = isAddress(form.priceFeed);
  const validSymbol = form.assetSymbol.length > 0 && form.assetSymbol.length <= 16;
  const formValid = validAsset && validFeed && validSymbol;

  const buildListing = () => {
    const ltv = pctToBps(form.ltvPct);
    const liqThreshold = pctToBps(form.liqThresholdPct);
    // Aave V3 liqBonus stores 100% + bonus, so 5% bonus → 10500 bps
    const liqBonus = 10000n + pctToBps(form.liqBonusPct);
    const reserveFactor = pctToBps(form.reserveFactorPct);
    const liqProtocolFee = pctToBps(form.liqProtocolFeePct);

    return {
      asset: form.asset as `0x${string}`,
      assetSymbol: form.assetSymbol,
      priceFeed: form.priceFeed as `0x${string}`,
      rateStrategyParams: {
        optimalUsageRatio: pctToBps(form.optimalUsagePct),
        baseVariableBorrowRate: pctToBps(form.baseRatePct),
        variableRateSlope1: pctToBps(form.slope1Pct),
        variableRateSlope2: pctToBps(form.slope2Pct),
      },
      enabledToBorrow: form.enabledToBorrow ? ENABLED : DISABLED,
      borrowableInIsolation: DISABLED,
      withSiloedBorrowing: DISABLED,
      flashloanable: form.flashloanable ? ENABLED : DISABLED,
      ltv: form.enabledAsCollateral ? ltv : 0n,
      liqThreshold: form.enabledAsCollateral ? liqThreshold : 0n,
      liqBonus: form.enabledAsCollateral ? liqBonus : 0n,
      reserveFactor,
      supplyCap: BigInt(form.supplyCap || "0"),
      borrowCap: BigInt(form.borrowCap || "0"),
      debtCeiling: 0n,
      liqProtocolFee,
    };
  };

  const handleSubmit = () => {
    if (!isOwner || !formValid) return;
    writeContract({
      address: ADDRESSES.assetListingProxy,
      abi: ASSET_LISTING_PROXY_ABI,
      functionName: "listAssets",
      args: [NETWORK_CONTEXT, [buildListing()]],
    });
  };

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">List Asset</h1>
        <p className="text-muted-foreground text-sm">Admin: add a new reserve to the Aave V3 pool</p>
      </div>

      {!isConnected ? (
        <div className="technical-border bg-card animate-in-delay-1">
          <p className="py-12 text-center text-muted-foreground">Connect your wallet to use this page</p>
        </div>
      ) : !isOwner ? (
        <div className="technical-border bg-amber-500/10 border-amber-500/30 p-4 animate-in-delay-1">
          <p className="text-sm text-amber-400 font-medium">Not authorized</p>
          <p className="text-xs text-muted-foreground mt-1">
            AssetListingProxy owner: <span className="font-mono">{(owner.data as string) ?? "—"}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">Connect with the owner wallet to list assets.</p>
        </div>
      ) : (
        <div className="technical-border bg-card animate-in-delay-1 p-6 space-y-6">
          <Section title="Asset">
            <Field label="Asset Address" value={form.asset} onChange={(v) => set("asset", v)} placeholder="0x…" mono valid={form.asset === "" || validAsset} />
            <Field label="Symbol" value={form.assetSymbol} onChange={(v) => set("assetSymbol", v.toUpperCase())} placeholder="USDT" valid={form.assetSymbol === "" || validSymbol} />
            <Field label="Price Feed (Chainlink-compatible)" value={form.priceFeed} onChange={(v) => set("priceFeed", v)} placeholder="0x…" mono valid={form.priceFeed === "" || validFeed} />
          </Section>

          <Section title="Risk Parameters (%)">
            <FieldNumber label="LTV" value={form.ltvPct} onChange={(v) => set("ltvPct", v)} />
            <FieldNumber label="Liquidation Threshold" value={form.liqThresholdPct} onChange={(v) => set("liqThresholdPct", v)} />
            <FieldNumber label="Liquidation Bonus" value={form.liqBonusPct} onChange={(v) => set("liqBonusPct", v)} />
            <FieldNumber label="Reserve Factor" value={form.reserveFactorPct} onChange={(v) => set("reserveFactorPct", v)} />
            <FieldNumber label="Liquidation Protocol Fee" value={form.liqProtocolFeePct} onChange={(v) => set("liqProtocolFeePct", v)} />
          </Section>

          <Section title="Caps (whole tokens)">
            <FieldNumber label="Supply Cap" value={form.supplyCap} onChange={(v) => set("supplyCap", v)} />
            <FieldNumber label="Borrow Cap" value={form.borrowCap} onChange={(v) => set("borrowCap", v)} />
          </Section>

          <Section title="Interest Rate Strategy (%)">
            <FieldNumber label="Optimal Usage Ratio" value={form.optimalUsagePct} onChange={(v) => set("optimalUsagePct", v)} />
            <FieldNumber label="Base Variable Borrow Rate" value={form.baseRatePct} onChange={(v) => set("baseRatePct", v)} />
            <FieldNumber label="Variable Rate Slope 1" value={form.slope1Pct} onChange={(v) => set("slope1Pct", v)} />
            <FieldNumber label="Variable Rate Slope 2" value={form.slope2Pct} onChange={(v) => set("slope2Pct", v)} />
          </Section>

          <Section title="Flags">
            <Toggle label="Enabled to Borrow" checked={form.enabledToBorrow} onChange={(v) => set("enabledToBorrow", v)} />
            <Toggle label="Flashloanable" checked={form.flashloanable} onChange={(v) => set("flashloanable", v)} />
            <Toggle label="Usable as Collateral" checked={form.enabledAsCollateral} onChange={(v) => set("enabledAsCollateral", v)} />
          </Section>

          <TxButton
            onClick={handleSubmit}
            isPending={isPending}
            isConfirming={isConfirming}
            disabled={!formValid}
          >
            List {form.assetSymbol || "Asset"}
          </TxButton>

          {!formValid && (
            <p className="text-xs text-amber-400 font-mono">Fill asset address, symbol, and price feed to submit.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-mono uppercase tracking-[0.2em] text-accent mb-3">{title}</h2>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, valid = true }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; mono?: boolean; valid?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full h-10 px-3 text-sm bg-background border ${valid ? "border-border" : "border-rose-500/50"} ${mono ? "font-mono" : ""} text-foreground placeholder:text-muted-foreground focus:border-accent/50 focus:outline-none transition-colors`}
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void; }) {
  return (
    <label className="flex items-center gap-3 h-10 px-3 border border-border bg-background cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
    </label>
  );
}
