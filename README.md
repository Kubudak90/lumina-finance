# Lumina Finance — Frontend

Next.js 16 (App Router) + React 19 UI for the Lumina Finance lending markets on **Base Sepolia (chainId 84532)**.

This app talks to the Lumina Aave V3 fork (core, isolated, looping) over a verified EVM.
Lighter is a separate trading/account domain (REST + WebSocket + signing chain id 304) and is not used as a wagmi EVM RPC.

Requires **Node.js 20.9+**. Install with `npm ci` — do not use `--legacy-peer-deps`. ConnectKit is not used because its peers are React 17/18 only; the wallet modal is RainbowKit.

`lighter-ts@1.0.2` is isolated behind `lib/lighter/`. UI code imports the public barrel (`@/lib/lighter`); only `lib/lighter/runtime/` and the lazy `/lighter` and `/portfolio` pages may load the SDK. The 7.5 MiB Go WASM signer is fetched at runtime (override with `NEXT_PUBLIC_LIGHTER_WASM_URL`) and is not vendored.

The `/lighter` route is read-only: account discovery, REST bootstrap, websocket status, and official multiplier helpers. `/portfolio` adds a unified Lumina + Lighter summary (USD totals, isolated positions, freshness badges). Trading signer methods throw. API keys are stored in namespaced `localStorage` (`lumina.lighter.auth`) and are XSS-equivalent to a trading capability — see the on-page threat model.

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in the values:
   ```bash
   cp .env.example .env.local
   ```
   - `NEXT_PUBLIC_WC_PROJECT_ID` — required for the wallet modal (WalletConnect Cloud project id).
   - `NEXT_PUBLIC_LIGHTER_WASM_URL` — optional WASM URL for the Lighter signer (jsDelivr default).

2. Install deps and run the dev server:
   ```bash
   npm ci
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Oracle keeper

The canonical keeper runs on the ops VPS as a systemd timer —
see `keeper-vps/` in `lumina-monorepo`. It must use a dedicated keeper key,
not a frontend/Vercel private key. There is no in-app cron route.

## Deployment

Deployed via the Vercel CLI (`vercel deploy --prod`) to the `lightlend-frontend`
project at `luminafinance.xyz`. There is **no GitHub integration**; pushing to
`main` does not auto-deploy.

## Structure

- `app/` — App Router pages: dashboard, markets, isolated, leverage, faucet, admin, `/lighter`
- `components/` — UI + modals (supply / borrow / withdraw / repay / leverage / liquidate)
- `lib/` — chain config, contract addresses, ABIs, helpers
- `lib/lighter/` — public Lighter adapter (no SDK import); `runtime/` loads `lighter-ts` on `/lighter` only
- `hooks/` — wagmi hooks for reserves, health factor, e-mode, rewards, prices
- `providers/Web3Provider.tsx` — wagmi + RainbowKit (Base Sepolia + Ethereum for Lighter L1)

## Learn More

- [Next.js docs](https://nextjs.org/docs)
- [wagmi docs](https://wagmi.sh)
- [Aave V3 docs](https://aave.com/docs/developers/aave-v3)
