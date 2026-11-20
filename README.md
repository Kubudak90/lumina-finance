# Lumina Finance — Frontend

Next.js 16 (App Router) + React 19 UI for Lumina lending on **Lighter EVM devnet (chain 19529)**: the core
pool (Aave v3.2) and the isolated pairs (FraxLend). Supply, borrow, repay, withdraw and liquidation only;
looping and leverage are out of scope and have no UI.

Requires **Node.js 20.9+**. Install with `npm ci` (no `--legacy-peer-deps`). The wallet modal is RainbowKit.

## Configuration

Copy `.env.example` to `.env.local`:

- `NEXT_PUBLIC_LIGHTER_DEVNET_RPC_URL` — RPC of chain 19529 (the client-side twin of the manifest's
  `rpcEnv`, `LIGHTER_DEVNET_RPC_URL`). Read at **build** time: it is inlined into the bundle and its origin
  is the only RPC origin the CSP allows. Without it every read fails fast and all actions are disabled.
- `NEXT_PUBLIC_WC_PROJECT_ID` — WalletConnect Cloud project id (required by the wallet modal).

No private key or secret is read anywhere in this app; there are no API routes.

```bash
npm ci
npm run dev        # http://localhost:3000
npm run lint && npx tsc --noEmit && npx vitest run && npm run build
```

## Addresses: the deployment manifest

`deployments/lighter-devnet.json` and its loader `deployments/index.mjs` are **byte-identical copies** of
`lumina-monorepo/deployments/` (branch `lighter-devnet-v1`). Do not edit them here: re-copy them after the
deploy scripts fill the manifest. `lib/deployments.ts` validates the imported manifest with the loader
(`loadManifest({ chainId, data })`) and builds a registry keyed by chain id; every contract address the UI
uses comes from it. While the manifest is `status: "template"` (addresses `null`), no read targets a guessed
address and every transaction button is disabled ("Not deployed yet").

## Safety rules (spec §3.3, FE-02…FE-09)

- **Chain pinning.** Only `hooks/chain/` may use wagmi's contract hooks (ESLint `no-restricted-imports`
  and `lib/scope.test.ts` enforce it). Its wrappers pin every read, the public client, the simulation and
  the write to chain 19529; `lib/chainPin.ts` refuses a write when the wallet, the simulating client or
  the request names another chain. Every `TxButton` is disabled while the wallet is on another chain. The
  wagmi config has no other chain (no Ethereum mainnet).
- **Approvals** (`lib/approvals.ts`). Supply, lend (deposit), add-collateral and core liquidation approve
  the exact amount. Every repay, partial or full, on both venues approves `ceil(value × 1.001) + 1`, where
  `value` is the current debt (core) or the current value of the borrow shares being repaid (isolated,
  `toBorrowAmount(shares, true, true)`). Isolated liquidations are share-based too and use the same
  buffer. A full core repay sends Aave's entire-debt sentinel as the `amount` argument (never as an
  allowance), and withdraw-all sends the entire-balance sentinel, so no dust remains. Allowances at or
  above 2^128 are refused at runtime. The current allowance and the maximum residual allowance are shown in
  every approving modal. There is no credit delegation.
- **Borrow MAX** (`lib/borrowMax.ts`). Core: 99% of `availableBorrowsBase` (LTV-based) at the AaveOracle
  price, capped by the reserve's virtual balance and borrow-cap headroom. Isolated: 99% of the room under
  the pair's `maxLTV` at its oracle exchange rate, capped by pair liquidity and borrow limit. Bigint,
  floored to base units.
- **Prices** (`lib/prices.ts`). USD figures use `AaveOracle.getAssetPrice`, keyed by asset address.
  Isolated collateral is converted to asset units with the pair oracle's exchange rate, then priced. A
  missing price shows "—", never $0. There is no CoinGecko or other off-chain price.
- **Freshness.** Positions, health factor, allowances, prices and the guard status poll every 15 s. Position
  reads carry Multicall3 `getBlockNumber` / `getCurrentBlockTimestamp` in the same call and are shown as
  "as of block N · Xs ago"; badges are age-based ("fresh" / "stale"), never presence-based.
  `LuminaPriceGuard.borrowStatus()` is shown wherever borrowing is possible, with the reason when borrows are
  blocked (e.g. a stale keeper reference).
- **Headers** (`lib/security/csp.mjs`, applied in `next.config.mjs`). CSP with `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. `connect-src` allows only
  the RPC origin, WalletConnect, and the read-only Lighter trading API. The headers are static, so scripts
  need `'unsafe-inline'` (Next.js bootstrap); nonces would require a proxy and dynamic rendering.

## Decisions beyond the spec

- `/admin/*` pages are removed (listing and governance go through Safe / Executor payloads), as are the
  faucet (no mock-token faucets on Lighter), E-Mode (no categories in devnet v1) and rewards (no rewards
  controller in the manifest).
- Isolated pairs come from the manifest, not from registry discovery.
- An isolated **Add collateral** action exists, because `borrowAsset` is blocked while the guard trips and
  spec §5.4 promises that add-collateral keeps working.
- Wallets are injected, MetaMask, Rainbow and WalletConnect only (no Coinbase SDK), so the CSP needs no
  further origins.
- `/lighter` stays a read-only trading view: it uses only the connected address, so it needs no Ethereum
  mainnet chain and never prompts a network switch. Its Go WASM signer URL (jsDelivr) is not in the CSP;
  that latent path stays blocked until the WASM is vendored (FE-10).

## Structure

- `app/` — pages: dashboard, markets, isolated, portfolio, liquidations, `/lighter`
- `components/` — UI and action modals
- `hooks/chain/` — the only wagmi contract-hook layer (pinned reads/writes, action gate)
- `hooks/` — reserves, positions, isolated pairs, oracle prices, guard status, approvals
- `lib/` — manifest registry, chain, approvals, borrow MAX, prices, guard, CSP, ABIs
- `lib/lighter/` — read-only Lighter trading adapter; `runtime/` loads `lighter-ts` on `/lighter` and `/portfolio` only

## Deployment

Not deployed from here until the devnet deploy is verified (workflow step S12). The production site stays
on the maintenance page until then.
