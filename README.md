# Lumina Finance — Frontend

Next.js (App Router) UI for the Lumina Finance lending markets on **Base Sepolia (chainId 84532)**.

This app talks to the Lumina Aave V3 fork (core, isolated, looping) over a verified EVM.
Lighter is a separate trading/account domain and is not used as a wagmi chain.

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in the values:
   ```bash
   cp .env.example .env.local
   ```
   - `NEXT_PUBLIC_WC_PROJECT_ID` — required for the wallet modal (WalletConnect Cloud project id).

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

- `app/` — App Router pages: dashboard, markets, isolated, leverage, faucet, admin
- `components/` — UI + modals (supply / borrow / withdraw / repay / leverage / liquidate)
- `lib/` — chain config, contract addresses, ABIs, helpers
- `lib/lighter/` — Lighter REST/signing config (no Solidity RPC)
- `hooks/` — wagmi hooks for reserves, health factor, e-mode, rewards, prices
- `providers/Web3Provider.tsx` — wagmi + WalletConnect setup

## Learn More

- [Next.js docs](https://nextjs.org/docs)
- [wagmi docs](https://wagmi.sh)
- [Aave V3 docs](https://aave.com/docs/developers/aave-v3)
