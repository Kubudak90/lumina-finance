import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "@/lib/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FeedConfig {
  label: string;
  coinId: string;
  feed: `0x${string}`;
  token: `0x${string}`;
  decimals: number;
  syncToSwapper: boolean;
}

const FEEDS: FeedConfig[] = [
  {
    label: "LIT",
    coinId: "lighter",
    feed: "0x1c2af9252306DD4Be3fF79980302C64a7BA46B1d",
    token: "0xDf2B23A45B9a451c002c27F83e9e55da5efdc992",
    decimals: 18,
    syncToSwapper: true,
  },
  {
    label: "WETH",
    coinId: "ethereum",
    feed: "0x9966BCA6eD030256c2585D8823ecF035e296f49A",
    token: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    syncToSwapper: true,
  },
];

const MOCK_SWAPPER = "0x387Ec86135feAbC98F75729F75b9F3EA4e99c114" as `0x${string}`;

const FEED_ABI = parseAbi([
  "function setAnswer(int256 newAnswer) external",
  "function latestAnswer() view returns (int256)",
]);
const SWAPPER_ABI = parseAbi([
  "function setPrice(address token, uint256 price1e8, uint8 decimals) external",
  "function priceUsd1e8(address token) view returns (uint256)",
]);

function priceTo1e8(usd: number): bigint {
  return BigInt(Math.round(usd * 1e8));
}

async function fetchPrices(coinIds: string[], apiKey?: string) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(",")}&vs_currencies=usd`;
  const res = await fetch(url, {
    headers: apiKey ? { "x-cg-pro-api-key": apiKey } : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  return (await res.json()) as Record<string, { usd: number }>;
}

export async function GET(req: Request) {
  // Vercel Cron sends an Authorization header with CRON_SECRET; require it.
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && auth !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) return Response.json({ error: "DEPLOYER_PRIVATE_KEY missing" }, { status: 500 });

  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });

  // Batch CoinGecko fetch
  const coinIds = Array.from(new Set(FEEDS.map((f) => f.coinId)));
  const cg = await fetchPrices(coinIds, process.env.COINGECKO_API_KEY);

  const log: Record<string, unknown>[] = [];

  for (const f of FEEDS) {
    const usd = cg[f.coinId]?.usd;
    if (typeof usd !== "number") {
      log.push({ label: f.label, status: "no-price", coinId: f.coinId });
      continue;
    }
    const newAnswer = priceTo1e8(usd);

    // Aggregator
    const prev = (await publicClient.readContract({
      address: f.feed,
      abi: FEED_ABI,
      functionName: "latestAnswer",
    })) as bigint;

    const entry: Record<string, unknown> = { label: f.label, usd, newAnswer: newAnswer.toString() };

    if (prev !== newAnswer) {
      const tx = await walletClient.writeContract({
        address: f.feed,
        abi: FEED_ABI,
        functionName: "setAnswer",
        args: [newAnswer],
      });
      entry.feedTx = tx;
      entry.feedFrom = prev.toString();
    } else {
      entry.feed = "unchanged";
    }

    // MockSwapper mirror
    if (f.syncToSwapper) {
      const swapperPrev = (await publicClient.readContract({
        address: MOCK_SWAPPER,
        abi: SWAPPER_ABI,
        functionName: "priceUsd1e8",
        args: [f.token],
      })) as bigint;

      if (swapperPrev !== newAnswer) {
        const tx = await walletClient.writeContract({
          address: MOCK_SWAPPER,
          abi: SWAPPER_ABI,
          functionName: "setPrice",
          args: [f.token, newAnswer, f.decimals],
        });
        entry.swapperTx = tx;
        entry.swapperFrom = swapperPrev.toString();
      } else {
        entry.swapper = "unchanged";
      }
    }

    log.push(entry);
  }

  return Response.json({ ok: true, ts: new Date().toISOString(), log });
}
