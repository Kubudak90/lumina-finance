# Lumina Finance — Frontend

Next.js (App Router) UI for the Lumina Finance lending markets on **Base Sepolia (chainId 84532)**.

This app talks to the Lumina Aave V3 fork (core, isolated, looping) and also hosts the
oracle keeper as a Vercel Cron route.

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in the values:
   ```bash
   cp .env.example .env.local
   ```
   - `NEXT_PUBLIC_WC_PROJECT_ID` — required for the wallet modal (WalletConnect Cloud project id).
   - `CRON_SECRET` — only required in production / when testing the cron route locally.
   - `DEPLOYER_PRIVATE_KEY` — only required if you want the cron route to actually broadcast tx.
   - `COINGECKO_API_KEY` — optional, falls back to the free public endpoint.

2. Install deps and run the dev server:
   ```bash
   npm install
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Oracle keeper

The canonical keeper runs on the ops VPS as a systemd timer every 30 minutes —
see `keeper-vps/` at the repo root. It pushes USD prices from CoinGecko into the
`UpdatableAggregator` feeds (consumed by `AaveOracle`) and `MockSwapper` on
Base Sepolia.

The route handler at `app/api/cron/update-prices/route.ts` is kept around for
ad-hoc manual triggers (and still needs `DEPLOYER_PRIVATE_KEY` + `CRON_SECRET`
in Vercel env if you want to invoke it), but no Vercel Cron schedule is
configured — Vercel Hobby caps cron frequency at once per day.

## Deployment

Deployed via the Vercel CLI (`vercel deploy --prod`) to the `lightlend-frontend`
project at `luminafinance.xyz`. There is **no GitHub integration**; pushing to
`main` does not auto-deploy.

## Structure

- `app/` — App Router pages: dashboard, markets, isolated, leverage, faucet, admin
- `components/` — UI + modals (supply / borrow / withdraw / repay / leverage / liquidate)
- `lib/` — chain config, contract addresses, ABIs, helpers
- `hooks/` — wagmi hooks for reserves, health factor, e-mode, rewards, prices
- `providers/Web3Provider.tsx` — wagmi + WalletConnect setup

## Learn More

- [Next.js docs](https://nextjs.org/docs)
- [wagmi docs](https://wagmi.sh)
- [Aave V3 docs](https://aave.com/docs/developers/aave-v3)
