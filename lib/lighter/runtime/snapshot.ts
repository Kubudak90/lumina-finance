"use client";

import {
  selectAccountExistence,
  selectL1Address,
  selectUserAccountIndex,
  useAccountEquity,
  useLighterStore,
  useUserAccount,
  useWsSubStore,
} from "lighter-ts";
import { useAccount } from "wagmi";
import { LIGHTER_L1_CHAIN_ID } from "../config";
import { realPriceToDisplay, realSizeToDisplay } from "../units";
import type { LighterPosition, LighterSnapshot } from "../types";

export function useLighterSnapshot(): LighterSnapshot {
  const { chainId } = useAccount();
  const l1Address = useLighterStore(selectL1Address);
  const accountIndex = useLighterStore(selectUserAccountIndex);
  const existence = useLighterStore(selectAccountExistence);
  const account = useUserAccount();
  const equity = useAccountEquity(account);
  const ws = useWsSubStore((state) => state.ws);
  const wsSessionId = useWsSubStore((state) => state.wsSessionId ?? null);
  const lastPongAt = useWsSubStore((state) => state.lastPongTime);
  const perpsMarkets = useLighterStore((state) => state.perpsOrderBookMetas);

  const positions: LighterPosition[] = (account?.positions ?? []).map((position) => {
    const market = perpsMarkets[String(position.market_id)];
    const params = {
      multiplier: String(market?.multiplier ?? "1"),
      display_size_decimals: market?.display_size_decimals ?? 4,
      display_price_decimals: market?.display_price_decimals ?? 2,
    };
    const size = Number(position.position);
    const mark = size === 0 ? 0 : Number(position.position_value) / Math.abs(size);
    return {
      marketId: position.market_id,
      symbol: position.symbol || market?.symbol || market?.backend_symbol || `market-${position.market_id}`,
      side: position.sign > 0 ? "long" : position.sign < 0 ? "short" : "flat",
      displaySize: realSizeToDisplay(Math.abs(size), params),
      displayAvgEntry: realPriceToDisplay(Number(position.avg_entry_price), params),
      displayMark: realPriceToDisplay(mark || Number(position.avg_entry_price), params),
      unrealizedPnl: Number(position.unrealized_pnl ?? 0),
      funding: Number(position.total_funding_paid_out ?? 0),
      marginMode: Number(position.margin_mode) === 1 ? "isolated" : "cross",
    };
  });

  const balances = (account?.assets ?? []).map((asset) => ({
    symbol: asset.symbol,
    displayAmount: Number(asset.balance ?? 0),
    lockedAmount: Number(asset.locked_balance ?? 0),
  }));

  return {
    l1Address,
    l1ChainId: chainId ?? null,
    onOfficialL1: chainId === LIGHTER_L1_CHAIN_ID,
    accountIndex,
    existence,
    authenticated: existence === "Exists",
    wsConnected: Boolean(ws),
    wsSessionId,
    lastPongAt,
    equity: {
      total: equity.totalEquity,
      perps: equity.perpsEquity,
      spot: equity.spotEquity,
    },
    collateral: account?.collateral ?? null,
    availableBalance: account?.available_balance ?? null,
    balances,
    positions,
    updatedAt: Date.now(),
  };
}
