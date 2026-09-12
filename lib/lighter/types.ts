export type LighterAccountExistence =
  | "GeoBlocked"
  | "NoWallet"
  | "Deciding"
  | "KeysDontMatch"
  | "ShouldDeposit"
  | "DepositInProgress"
  | "Creating"
  | "Exists";

export type LighterBalance = {
  symbol: string;
  displayAmount: number;
  lockedAmount: number;
};

export type LighterPosition = {
  marketId: number;
  symbol: string;
  side: "long" | "short" | "flat";
  displaySize: number;
  displayAvgEntry: number;
  displayMark: number;
  unrealizedPnl: number;
  funding: number;
  marginMode: string;
};

export type LighterEquity = {
  total: number | null;
  perps: number | null;
  spot: number | null;
};

export type LighterSnapshot = {
  l1Address: string;
  l1ChainId: number | null;
  onOfficialL1: boolean;
  accountIndex: number;
  existence: LighterAccountExistence;
  authenticated: boolean;
  wsConnected: boolean;
  wsSessionId: string | null;
  lastPongAt: number | null;
  equity: LighterEquity;
  collateral: number | null;
  availableBalance: number | null;
  balances: LighterBalance[];
  positions: LighterPosition[];
  updatedAt: number;
};

export const AUTH_STORAGE_THREAT_MODEL = [
  "Lighter API private keys (seed + public key) are stored in this origin's localStorage.",
  "They are equivalent to a trading capability for the registered API-key index. XSS on this origin can steal them.",
  "They are not HttpOnly cookies and are never sent to Lumina servers.",
  "Logout and invalid-signature recovery must delete them. Do not log seed/private material.",
].join(" ");
