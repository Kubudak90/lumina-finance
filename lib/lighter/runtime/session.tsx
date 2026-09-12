"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  API_KEY_INDEXES,
  createClient,
  queryClient,
  selectAccountExistence,
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
  useUserAccount,
  useUserAddress,
  useWsSubStore,
  type AccountExistence,
  type Encoding,
} from "lighter-ts";
import { useAccount, useSwitchChain } from "wagmi";
import { mainnet } from "wagmi/chains";
import {
  LIGHTER_SIGNING_CHAIN_ID,
  LIGHTER_WS_PING_INTERVAL_MS,
  LIGHTER_WS_PONG_TIMEOUT_MS,
  LIGHTER_WS_URL,
} from "../config";
import {
  AUTH_STORAGE_THREAT_MODEL,
  clearLighterAuthMaterial,
  readLSAccountSignature,
  readLSLastAccountIndex,
  removeLSSignature,
} from "../auth-storage";
import { logLighterError } from "../errors";
import { getOrCreateAuthToken, isRegistered, resetAuthToken } from "./auth";
import { apis } from "./apis";
import { ensureLighterRuntime } from "./bootstrap";
import { useLighterSnapshot } from "./snapshot";
import { initWASM, waitForWasm } from "./wasm";
import type { LighterSnapshot } from "../types";
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
    const nextAccountIndex = account?.index ?? 0;
    const hasStoredSignature =
      account != null && Boolean(readLSAccountSignature(account.index, API_KEY_INDEXES.DESKTOP));
    useLighterStore.setState((prev) => ({
      accountIndex: nextAccountIndex,
      accountTradingMode: account?.account_trading_mode ?? null,
      accountExistence:
        nextAccountIndex !== prev.accountIndex ? "Deciding" : prev.accountExistence,
      showOnboarding: prev.didJustConnect && !hasStoredSignature,
      didJustConnect: false,
    }));
  }, [accountsQuery.isPending, accountsQuery.isError, accountsQuery.data]);
}

function useVerifyAccount() {
  return useCallback(async (accountIndex: number, forceRefresh?: boolean) => {
    try {
      if (isRegistered(accountIndex) && !forceRefresh) return true;
      const apiKeyIndex = API_KEY_INDEXES.DESKTOP;
      const stored = readLSAccountSignature(accountIndex, apiKeyIndex);
      if (!stored) return false;
      const apiKey = await apis.accountApi
        .apikeys({ api_key_index: apiKeyIndex, account_index: accountIndex })
        .then(({ api_keys }) => api_keys[0]?.public_key)
        .catch(() => "");
      if (!apiKey || stored.pk !== apiKey) return false;
      await initWASM();
      await createClient({
        seed: stored.seed,
        chainId: LIGHTER_SIGNING_CHAIN_ID,
        accountIndex,
        nonce: 0,
        apiKeyIndex,
      });
      return true;
    } catch (error) {
      logLighterError(error, "verify-account");
      return false;
    }
  }, []);
}

function useIsRegisteredQuery() {
  const verifyAccount = useVerifyAccount();
  const userAccount = useUserAccount();
  return useQuery({
    queryKey: ["isRegistered", userAccount?.index],
    queryFn: () => verifyAccount(userAccount!.index),
    initialData: null,
    enabled: Boolean(userAccount),
    refetchInterval: (query) => (query.state.data === null && userAccount ? 2000 : false),
  });
}

function useAccountExistence(): AccountExistence {
  const userAddress = useUserAddress();
  const l1Initialized = useLighterStore(selectL1Initialized);
  const accountIndex = useLighterStore(selectUserAccountIndex);
  const accountsQuery = useAccountsQuery();
  const isRegisteredResult = useIsRegisteredQuery().data;

  if (!l1Initialized) return "Deciding";
  if (!userAddress) return "NoWallet";
  if (accountsQuery.isPending) return "Deciding";
  if (
    (!accountIndex && accountsQuery.isSuccess) ||
    (accountsQuery.isError && accountsQuery.error?.response?.status !== 400)
  ) {
    return "Deciding";
  }
  if (!accountIndex) return "ShouldDeposit";
  if (isRegisteredResult === null) return "Deciding";
  if (isRegisteredResult === false) return "KeysDontMatch";
  return "Exists";
}

function useSyncAccountExistence() {
  const accountExistence = useAccountExistence();
  useEffect(() => {
    useLighterStore.setState({ accountExistence });
  }, [accountExistence]);
}

function useInitWs() {
  const ws = useWsSubStore((state) => state.ws);
  const accountIndex = useLighterStore(selectUserAccountIndex);
  const isAuthed = useLighterStore(selectAccountExistence) === "Exists";

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
  const { switchChain, isPending } = useSwitchChain();

  return (
    <div className="space-y-6">
      <div className="technical-border bg-card p-4 space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-accent">Read-only</p>
        <h1 className="text-xl font-bold">Lighter portfolio</h1>
        <p className="text-sm text-text-dim">
          Account discovery, REST bootstrap, and websocket state. Trading is disabled in this adapter.
          Official example connects an injected wallet on Ethereum mainnet; Lumina lending stays on Base
          Sepolia.
        </p>
        {!snapshot.onOfficialL1 && snapshot.l1Address ? (
          <button
            type="button"
            className="text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-3 py-1.5 rounded"
            disabled={isPending}
            onClick={() => switchChain({ chainId: mainnet.id })}
          >
            {isPending ? "Switching…" : "Switch wallet to Ethereum (official Lighter L1)"}
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="L1 address" value={snapshot.l1Address ? `${snapshot.l1Address.slice(0, 6)}…${snapshot.l1Address.slice(-4)}` : "—"} />
        <Stat label="Account index" value={String(snapshot.accountIndex || "—")} />
        <Stat label="Status" value={snapshot.existence} />
        <Stat label="WebSocket" value={snapshot.wsConnected ? "connected" : "offline"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total equity" value={usd(snapshot.equity.total)} />
        <Stat label="Perps equity" value={usd(snapshot.equity.perps)} />
        <Stat label="Spot equity" value={usd(snapshot.equity.spot)} />
        <Stat label="Collateral" value={usd(snapshot.collateral)} />
        <Stat label="Available" value={usd(snapshot.availableBalance)} />
        <Stat label="Authenticated" value={snapshot.authenticated ? "yes" : "no"} />
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
    queryClient.removeQueries({ queryKey: ["isRegistered"] });
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
  const combined = combinePortfolio(lumina, snapshot);
  const status = lighterFreshness(snapshot.wsConnected, snapshot.lastPongAt);

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
              detail={snapshot.existence === "Exists" ? "authenticated" : snapshot.existence}
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
