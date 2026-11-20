"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  queryClient,
  selectAssetMetasLoaded,
  selectL1Initialized,
  selectOrderBookMetasLoaded,
  selectUserAccountIndex,
  useAccountsQuery,
  useInitAccountLimits,
  useInitAssetMetas,
  useInitL1Info,
  useInitOrderBookMetas,
  useInitSystemConfig,
  useInitTokens,
  useLighterStore,
  useUserAddress,
  useWsSubStore,
  type Encoding,
} from "lighter-ts";
import { useAccount } from "wagmi";
import { NETWORK_NAME } from "@/lib/chains";
import {
  LIGHTER_WS_PING_INTERVAL_MS,
  LIGHTER_WS_PONG_TIMEOUT_MS,
  LIGHTER_WS_URL,
} from "../config";
import {
  AUTH_STORAGE_THREAT_MODEL,
  clearLighterAuthMaterial,
  readLSLastAccountIndex,
  removeLSSignature,
} from "../auth-storage";
import { READ_ONLY_NOTE, readOnlyAccountExistence, type ReadOnlyAccountExistence } from "../existence";
import { getOrCreateAuthToken, resetAuthToken } from "./auth";
import { useReadOnlyStore } from "./readOnlyStore";
import { ensureLighterRuntime } from "./bootstrap";
import { useLighterSnapshot } from "./snapshot";
import { waitForWasm } from "./wasm";
import type { LighterSnapshot } from "../types";
import { useFreshnessNow } from "@/lib/portfolio/clock";
import { combinePortfolio, lighterFreshness, type LuminaLegs } from "@/lib/portfolio/combine";
import { FreshnessBadge } from "@/components/portfolio/FreshnessBadge";
import Link from "next/link";

const ENCODING = "json" as Encoding;

function useSyncL1Address() {
  const { address } = useAccount();
  useEffect(() => {
    if (address) {
      useLighterStore.setState({ l1Address: address, l1Initialized: true, didJustConnect: true });
    } else {
      useLighterStore.setState({ l1Address: "", l1Initialized: false });
    }
  }, [address]);
}

function useAccountSelection() {
  const accountsQuery = useAccountsQuery();
  useEffect(() => {
    if (accountsQuery.isPending) return;
    if (accountsQuery.isError) {
      useLighterStore.setState({ accountIndex: 0, accountExistence: "Deciding" });
      return;
    }
    const lastAccountIndex = readLSLastAccountIndex().data;
    const account =
      (lastAccountIndex ? accountsQuery.data?.accountsByIndex[lastAccountIndex] : undefined) ??
      accountsQuery.data?.mainAccount;
    useLighterStore.setState({
      accountIndex: account?.index ?? 0,
      accountTradingMode: account?.account_trading_mode ?? null,
      // Read-only: no onboarding and no key checks (the stored seed is never read).
      showOnboarding: false,
      didJustConnect: false,
    });
  }, [accountsQuery.isPending, accountsQuery.isError, accountsQuery.data]);
}

/** Read-only account state; never reads the stored signing seed (Codex r1 #13). */
function useReadOnlyExistence(): ReadOnlyAccountExistence {
  const userAddress = useUserAddress();
  const l1Initialized = useLighterStore(selectL1Initialized);
  const accountIndex = useLighterStore(selectUserAccountIndex);
  const accountsQuery = useAccountsQuery();
  return readOnlyAccountExistence({
    l1Initialized,
    userAddress,
    accountIndex,
    accountsPending: accountsQuery.isPending,
    accountsSuccess: accountsQuery.isSuccess,
    accountsError: accountsQuery.isError,
    accountsErrorStatus: accountsQuery.error?.response?.status,
  });
}

function useSyncAccountExistence() {
  const existence = useReadOnlyExistence();
  useEffect(() => {
    useReadOnlyStore.setState({ existence });
    // lighter-ts only knows its own states; "ReadOnly" is never "Exists" (no authenticated WS).
    useLighterStore.setState({ accountExistence: existence === "ReadOnly" ? "Deciding" : existence });
  }, [existence]);
}

function useInitWs() {
  const ws = useWsSubStore((state) => state.ws);
  const accountIndex = useLighterStore(selectUserAccountIndex);
  // Read-only view: never authenticated (no seed, no auth token).
  const isAuthed = false;

  useEffect(() => {
    const init = () => {
      void useWsSubStore.getState().actions.init(
        LIGHTER_WS_URL,
        () => undefined,
        () => getOrCreateAuthToken(accountIndex),
        ENCODING,
        null
      );
    };
    init();
    const interval = setInterval(init, LIGHTER_WS_PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [accountIndex]);

  useEffect(() => {
    if (!ws) return;
    useWsSubStore.getState().actions.switchAccount(accountIndex, isAuthed, waitForWasm, getOrCreateAuthToken);
  }, [ws, accountIndex, isAuthed]);

  useEffect(() => {
    if (!ws) return;
    useWsSubStore.getState().actions.subscribeHeight();
    const interval = setInterval(() => {
      const lastPingTime = useWsSubStore.getState().lastPingTime;
      const lastPongTime = useWsSubStore.getState().lastPongTime;
      if (lastPingTime && lastPongTime && lastPingTime - lastPongTime > LIGHTER_WS_PONG_TIMEOUT_MS) {
        useWsSubStore.getState().actions.forceClose();
        return;
      }
      useWsSubStore.getState().actions.ping();
    }, LIGHTER_WS_PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [ws]);
}

function LighterSideEffects() {
  useSyncL1Address();
  useAccountSelection();
  useInitAccountLimits();
  useInitWs();
  useSyncAccountExistence();
  useInitTokens();
  useInitOrderBookMetas();
  useInitAssetMetas();
  useInitSystemConfig();
  useInitL1Info();
  return null;
}

function DataGate({ children }: { children: ReactNode }) {
  const orderBooks = useLighterStore(selectOrderBookMetasLoaded);
  const assets = useLighterStore(selectAssetMetasLoaded);
  if (!orderBooks || !assets) {
    return <p className="text-sm text-text-dim">Loading Lighter markets…</p>;
  }
  return children;
}

function usd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function ReadOnlyPanel({ snapshot }: { snapshot: LighterSnapshot }) {
  return (
    <div className="space-y-6">
      <div className="technical-border bg-card p-4 space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-accent">Read-only</p>
        <h1 className="text-xl font-bold">Lighter portfolio</h1>
        <p className="text-sm text-text-dim">
          Account discovery, REST bootstrap, and websocket state. Trading is disabled in this adapter.
          Lighter accounts are looked up by your wallet address, so no network switch is needed here;
          Lumina lending runs on {NETWORK_NAME}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="L1 address" value={snapshot.l1Address ? `${snapshot.l1Address.slice(0, 6)}…${snapshot.l1Address.slice(-4)}` : "—"} />
        <Stat label="Account index" value={String(snapshot.accountIndex || "—")} />
        <Stat label="Status" value={snapshot.existence === "ReadOnly" ? READ_ONLY_NOTE : snapshot.existence} />
        <Stat label="WebSocket" value={snapshot.wsConnected ? "connected" : "offline"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total equity" value={usd(snapshot.equity.total)} />
        <Stat label="Perps equity" value={usd(snapshot.equity.perps)} />
        <Stat label="Spot equity" value={usd(snapshot.equity.spot)} />
        <Stat label="Collateral" value={usd(snapshot.collateral)} />
        <Stat label="Available" value={usd(snapshot.availableBalance)} />
        <Stat label="Authenticated" value="no (read-only)" />
      </div>

      <section className="technical-border bg-card p-4">
        <h2 className="text-sm font-bold mb-3">Balances</h2>
        {snapshot.balances.length === 0 ? (
          <p className="text-sm text-text-dim">No balances.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-dim">
                <th className="py-1">Asset</th>
                <th className="py-1">Amount</th>
                <th className="py-1">Locked</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.balances.map((balance) => (
                <tr key={balance.symbol} className="border-t border-border">
                  <td className="py-1.5 font-mono">{balance.symbol}</td>
                  <td className="py-1.5 font-mono">{balance.displayAmount}</td>
                  <td className="py-1.5 font-mono">{balance.lockedAmount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="technical-border bg-card p-4">
        <h2 className="text-sm font-bold mb-3">Positions</h2>
        {snapshot.positions.length === 0 ? (
          <p className="text-sm text-text-dim">No open positions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-dim">
                <th className="py-1">Market</th>
                <th className="py-1">Side</th>
                <th className="py-1">Size</th>
                <th className="py-1">Entry</th>
                <th className="py-1">uPnL</th>
                <th className="py-1">Funding</th>
                <th className="py-1">Margin</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.positions.map((position) => (
                <tr key={position.marketId} className="border-t border-border">
                  <td className="py-1.5 font-mono">{position.symbol}</td>
                  <td className="py-1.5">{position.side}</td>
                  <td className="py-1.5 font-mono">{position.displaySize}</td>
                  <td className="py-1.5 font-mono">{position.displayAvgEntry}</td>
                  <td className="py-1.5 font-mono">{usd(position.unrealizedPnl)}</td>
                  <td className="py-1.5 font-mono">{usd(position.funding)}</td>
                  <td className="py-1.5">{position.marginMode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="technical-border bg-card p-4 space-y-2">
        <h2 className="text-sm font-bold">API key storage</h2>
        <p className="text-xs text-text-dim leading-relaxed">{AUTH_STORAGE_THREAT_MODEL}</p>
        <LogoutButton />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="technical-border bg-card p-3">
      <div className="text-[10px] font-mono uppercase tracking-widest text-text-dim">{label}</div>
      <div className="mt-1 text-sm font-mono font-bold">{value}</div>
    </div>
  );
}

function LogoutButton() {
  const handleLogout = () => {
    clearLighterAuthMaterial();
    removeLSSignature();
    useLighterStore.setState({
      accountIndex: 0,
      accountExistence: "NoWallet",
      l1Address: "",
      userTier: null,
      accountTradingMode: null,
    });
    resetAuthToken();
    useWsSubStore.getState().actions.logout();
    queryClient.removeQueries({ queryKey: ["account"], exact: false });
  };
  return (
    <button
      type="button"
      onClick={handleLogout}
      className="text-xs font-semibold border border-border px-3 py-1.5 hover:bg-white/5"
    >
      Clear Lighter keys and session
    </button>
  );
}

function LighterReadOnlyInner() {
  const snapshot = useLighterSnapshot();
  return (
    <>
      <LighterSideEffects />
      <DataGate>
        <ReadOnlyPanel snapshot={snapshot} />
      </DataGate>
    </>
  );
}

export function LighterReadOnlyView() {
  useState(() => {
    ensureLighterRuntime();
    return null;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <LighterReadOnlyInner />
    </QueryClientProvider>
  );
}

function LighterPortfolioEmbedInner({ lumina }: { lumina: LuminaLegs }) {
  const snapshot = useLighterSnapshot();
  const now = useFreshnessNow();
  const combined = combinePortfolio(lumina, snapshot);
  const status = lighterFreshness(snapshot.wsConnected, snapshot.lastPongAt, now);

  return (
    <>
      <LighterSideEffects />
      <section className="technical-border bg-card p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-accent">Unified</p>
            <h2 className="text-sm font-bold">Lumina + Lighter</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <FreshnessBadge
              source="Lighter"
              status={status}
              detail={snapshot.existence === "ReadOnly" ? "read-only" : snapshot.existence}
            />
            <Link href="/lighter" className="text-[10px] font-mono uppercase tracking-wider text-accent hover:text-white">
              Full Lighter view
            </Link>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Combined USD" value={usd(combined.totalUsd)} />
          <Stat label="Lumina net" value={usd(combined.luminaNetUsd)} />
          <Stat label="Lighter equity" value={usd(combined.lighterEquityUsd)} />
          <Stat label="Net delta" value={usd(combined.netDeltaUsd)} />
        </div>
        <p className="text-[10px] text-text-dim">
          Combined USD is Lumina net worth plus Lighter equity. Net delta adds signed perp notional
          (long +, short −). Legs are not atomic.
        </p>
        <DataGate>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Perps equity" value={usd(snapshot.equity.perps)} />
            <Stat label="Spot equity" value={usd(snapshot.equity.spot)} />
            <Stat label="Perp delta" value={usd(combined.lighterPerpDeltaUsd)} />
          </div>
          {snapshot.positions.length === 0 ? (
            <p className="text-sm text-text-dim">No Lighter positions.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-dim">
                  <th className="py-1">Market</th>
                  <th className="py-1">Side</th>
                  <th className="py-1">Size</th>
                  <th className="py-1">uPnL</th>
                  <th className="py-1">Funding</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.positions.map((position) => (
                  <tr key={position.marketId} className="border-t border-border">
                    <td className="py-1.5 font-mono">{position.symbol}</td>
                    <td className="py-1.5">{position.side}</td>
                    <td className="py-1.5 font-mono">{position.displaySize}</td>
                    <td className="py-1.5 font-mono">{usd(position.unrealizedPnl)}</td>
                    <td className="py-1.5 font-mono">{usd(position.funding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataGate>
      </section>
    </>
  );
}

export function LighterPortfolioEmbed({ lumina }: { lumina: LuminaLegs }) {
  useState(() => {
    ensureLighterRuntime();
    return null;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <LighterPortfolioEmbedInner lumina={lumina} />
    </QueryClientProvider>
  );
}
