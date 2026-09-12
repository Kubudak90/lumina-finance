"use client";

import { useEffect, useRef, useState } from "react";
import { encodeAbiParameters, formatUnits, isAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useSimulatedWrite } from "@/hooks/useSimulatedWrite";
import { toast } from "sonner";
import { TxButton } from "@/components/common/TxButton";
import { ADDRESSES } from "@/lib/contracts";
import { QUERY } from "@/lib/queryPolicy";
import { ERC20_ABI, ISOLATED_DEPLOYER_ABI, ISOLATED_WHITELIST_ABI } from "@/lib/abis";
import { parseErrorMessage } from "@/lib/errorMessages";
import { txExplorerUrl } from "@/lib/explorer";

const CONFIG_DATA_TYPES = [
  { type: "address", name: "_asset" },
  { type: "address", name: "_collateral" },
  { type: "address", name: "_oracle" },
  { type: "uint32", name: "_maxOracleDeviation" },
  { type: "address", name: "_rateContract" },
  { type: "uint64", name: "_fullUtilizationRate" },
  { type: "uint256", name: "_maxLTV" },
  { type: "uint256", name: "_liquidationFee" },
  { type: "uint256", name: "_protocolLiquidationFee" },
] as const;

interface FormState {
  asset: string;
  collateral: string;
  oracle: string;
  maxOracleDeviationPct: string;
  rateContract: string;
  fullUtilizationRatePct: string;
  maxLTVPct: string;
  liquidationFeePct: string;
  protocolLiquidationFeePct: string;
}

const DEFAULTS: FormState = {
  asset: "",
  collateral: "",
  oracle: ADDRESSES.isolatedOracle,
  maxOracleDeviationPct: "1.5",
  rateContract: "",
  fullUtilizationRatePct: "100",
  maxLTVPct: "75",
  liquidationFeePct: "10",
  protocolLiquidationFeePct: "10",
};

// 1e5 precision conversion (Aave-style basis points × 10)
function pctTo1e5(input: string): bigint {
  const num = Number(input);
  if (!Number.isFinite(num) || num < 0) return 0n;
  return BigInt(Math.round(num * 1000));
}
// 1e18 precision
function pctTo1e18(input: string): bigint {
  const num = Number(input);
  if (!Number.isFinite(num) || num < 0) return 0n;
  return BigInt(Math.round(num * 10 ** 16));
}

export default function DeployPairPage() {
  const { address, isConnected } = useAccount();
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((s) => ({ ...s, [k]: v }));

  // Deployer config reads
  const amountToSeed = useReadContract({
    address: ADDRESSES.isolatedDeployer,
    abi: ISOLATED_DEPLOYER_ABI,
    functionName: "amountToSeed",
    query: { ...QUERY.config },
  });
  const whitelistAddr = useReadContract({
    address: ADDRESSES.isolatedDeployer,
    abi: ISOLATED_DEPLOYER_ABI,
    functionName: "lightlendWhitelistAddress",
  });
  const isWhitelisted = useReadContract({
    address: whitelistAddr.data as `0x${string}` | undefined,
    abi: ISOLATED_WHITELIST_ABI,
    functionName: "lightlendDeployerWhitelist",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!whitelistAddr.data },
  });

  // Asset balance & decimals (when asset address is valid)
  const validAsset = isAddress(form.asset);
  const assetDecimals = useReadContract({
    address: validAsset ? (form.asset as `0x${string}`) : undefined,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: validAsset },
  });
  const decimals = (assetDecimals.data as number | undefined) ?? 18;

  const deployerAssetBal = useReadContract({
    address: validAsset ? (form.asset as `0x${string}`) : undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ADDRESSES.isolatedDeployer],
    query: { enabled: validAsset, ...QUERY.config },
  });
  const userAssetBal = useReadContract({
    address: validAsset ? (form.asset as `0x${string}`) : undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: validAsset && !!address },
  });

  const seedAmount = (amountToSeed.data as bigint | undefined) ?? 0n;
  const deployerBal = (deployerAssetBal.data as bigint | undefined) ?? 0n;
  const userBal = (userAssetBal.data as bigint | undefined) ?? 0n;
  const seedShortfall = seedAmount > deployerBal ? seedAmount - deployerBal : 0n;
  const seedReady = seedAmount > 0n && deployerBal >= seedAmount;

  // Two transactions: optional seed transfer + deploy
  const seedTx = useSimulatedWrite();
  const deployTx = useSimulatedWrite();

  const prevSeedErr = useRef<Error | null>(null);
  useEffect(() => {
    if (seedTx.error && seedTx.error !== prevSeedErr.current) {
      prevSeedErr.current = seedTx.error;
      toast.error("Seed transfer failed", { description: parseErrorMessage(seedTx.error) });
    }
  }, [seedTx.error]);

  const prevDeployErr = useRef<Error | null>(null);
  useEffect(() => {
    if (deployTx.error && deployTx.error !== prevDeployErr.current) {
      prevDeployErr.current = deployTx.error;
      toast.error("Deploy failed", { description: parseErrorMessage(deployTx.error) });
    }
  }, [deployTx.error]);

  useEffect(() => {
    if (seedTx.isSuccess) {
      toast.success("Seed transferred to deployer");
      deployerAssetBal.refetch();
      userAssetBal.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedTx.isSuccess]);

  useEffect(() => {
    if (deployTx.isSuccess && deployTx.hash) {
      const hash = deployTx.hash;
      toast.success("Pair deployed", {
        action: { label: "View", onClick: () => window.open(txExplorerUrl(hash), "_blank") },
      });
    }
  }, [deployTx.isSuccess, deployTx.hash]);

  const handleSeed = () => {
    if (!validAsset || seedShortfall === 0n) return;
    void seedTx.send({
      address: form.asset as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [ADDRESSES.isolatedDeployer, seedShortfall],
    });
  };

  const handleDeploy = () => {
    if (!formValid) return;
    const configData = encodeAbiParameters(CONFIG_DATA_TYPES, [
      form.asset as `0x${string}`,
      form.collateral as `0x${string}`,
      form.oracle as `0x${string}`,
      Number(pctTo1e5(form.maxOracleDeviationPct)),
      form.rateContract as `0x${string}`,
      pctTo1e18(form.fullUtilizationRatePct),
      pctTo1e5(form.maxLTVPct),
      pctTo1e5(form.liquidationFeePct),
      pctTo1e5(form.protocolLiquidationFeePct),
    ]);
    void deployTx.send({
      address: ADDRESSES.isolatedDeployer,
      abi: ISOLATED_DEPLOYER_ABI,
      functionName: "deploy",
      args: [configData],
    });
  };

  const validCollateral = isAddress(form.collateral);
  const validOracle = isAddress(form.oracle);
  const validRateContract = isAddress(form.rateContract);
  const formValid = validAsset && validCollateral && validOracle && validRateContract;
  const whitelisted = isWhitelisted.data === true;

  return (
    <div className="space-y-6">
      <div className="animate-in">
        <h1 className="text-4xl font-bold tracking-tighter uppercase glow-text mb-1">Deploy Isolated Pair</h1>
        <p className="text-muted-foreground text-sm">Admin: deploy a new LightlendPair via the deployer contract</p>
      </div>

      {!isConnected ? (
        <div className="technical-border bg-card animate-in-delay-1 py-12 text-center text-muted-foreground">
          Connect your wallet to use this page
        </div>
      ) : !whitelisted ? (
        <div className="technical-border bg-amber-500/10 border-amber-500/30 p-4 animate-in-delay-1">
          <p className="text-sm text-amber-400 font-medium">Not whitelisted</p>
          <p className="text-xs text-muted-foreground mt-1">
            Connected wallet must be in the LightlendWhitelist to call deploy. Whitelist contract:{" "}
            <span className="font-mono">{(whitelistAddr.data as string) ?? "—"}</span>
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Status */}
          <div className="technical-border bg-card animate-in-delay-1 p-4 grid sm:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Whitelisted</div>
              <div className="font-mono text-emerald-400">YES</div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">amountToSeed</div>
              <div className="font-mono">{seedAmount.toString()} ({formatUnits(seedAmount, decimals)} {validAsset ? "asset" : ""})</div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Deployer asset balance</div>
              <div className={`font-mono ${seedReady ? "text-emerald-400" : "text-amber-400"}`}>
                {validAsset ? `${formatUnits(deployerBal, decimals)}` : "—"}
              </div>
            </div>
          </div>

          <div className="technical-border bg-card animate-in-delay-2 p-6 space-y-6">
            <Section title="Pair">
              <Field label="Asset Address" value={form.asset} onChange={(v) => set("asset", v)} placeholder="0x…" mono valid={form.asset === "" || validAsset} />
              <Field label="Collateral Address" value={form.collateral} onChange={(v) => set("collateral", v)} placeholder="0x…" mono valid={form.collateral === "" || validCollateral} />
            </Section>

            <Section title="Oracle">
              <Field label="Oracle Address" value={form.oracle} onChange={(v) => set("oracle", v)} placeholder="0x…" mono valid={form.oracle === "" || validOracle} />
              <FieldNumber label="Max Oracle Deviation (%)" value={form.maxOracleDeviationPct} onChange={(v) => set("maxOracleDeviationPct", v)} />
            </Section>

            <Section title="Interest Rate">
              <Field label="Rate Calculator Address" value={form.rateContract} onChange={(v) => set("rateContract", v)} placeholder="0x…" mono valid={form.rateContract === "" || validRateContract} />
              <FieldNumber label="Full Utilization Rate (%)" value={form.fullUtilizationRatePct} onChange={(v) => set("fullUtilizationRatePct", v)} />
            </Section>

            <Section title="Liquidation Parameters (%)">
              <FieldNumber label="Max LTV" value={form.maxLTVPct} onChange={(v) => set("maxLTVPct", v)} />
              <FieldNumber label="Liquidation Fee" value={form.liquidationFeePct} onChange={(v) => set("liquidationFeePct", v)} />
              <FieldNumber label="Protocol Liquidation Fee (of liq fee)" value={form.protocolLiquidationFeePct} onChange={(v) => set("protocolLiquidationFeePct", v)} />
            </Section>

            {/* Seed action */}
            {validAsset && seedShortfall > 0n && (
              <div className="technical-border bg-amber-500/10 border-amber-500/30 p-3 space-y-2">
                <p className="text-sm text-amber-400 font-medium">
                  Deployer needs {formatUnits(seedShortfall, decimals)} more of asset to seed the pair
                </p>
                <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  Your wallet balance: {formatUnits(userBal, decimals)} · Required: {formatUnits(seedAmount, decimals)}
                </p>
                <TxButton
                  onClick={handleSeed}
                  isPending={seedTx.isPending}
                  isSimulating={seedTx.isSimulating}
                  isConfirming={seedTx.isConfirming}
                  disabled={!validAsset || userBal < seedShortfall}
                >
                  Step 1: Send {formatUnits(seedShortfall, decimals)} asset to deployer
                </TxButton>
              </div>
            )}

            <TxButton
              onClick={handleDeploy}
              isPending={deployTx.isPending}
              isSimulating={deployTx.isSimulating}
              isConfirming={deployTx.isConfirming}
              disabled={!formValid || !seedReady}
            >
              {seedReady ? "Deploy Pair" : "Seed deployer first"}
            </TxButton>
          </div>
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
