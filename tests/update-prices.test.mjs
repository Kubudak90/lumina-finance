import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
globalThis.__keeperTest = { writes: 0, signs: 0, receipts: 0, receiptStatus: 'success', fetches: 0 };
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (['viem', 'viem/accounts', '@/lib/chains'].includes(specifier)) {
      return { url: `mock:${specifier}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith('mock:')) return next(url, context);
    let source;
    if (url === 'mock:viem') source = `
      export const http = () => ({});
      export const parseAbi = x => x;
      export const createPublicClient = () => ({
        readContract: async () => 1n,
        waitForTransactionReceipt: async () => {
          globalThis.__keeperTest.receipts++;
          return { status: globalThis.__keeperTest.receiptStatus };
        }
      });
      export const createWalletClient = () => ({ writeContract: async () => {
        globalThis.__keeperTest.writes++;
        return '0x123';
      }});
    `;
    else if (url === 'mock:viem/accounts') source = `export const privateKeyToAccount = () => {
      globalThis.__keeperTest.signs++; return {};
    };`;
    else source = 'export const baseSepolia = { id: 84532 };';
    return { format: 'module', source, shortCircuit: true };
  }
});
const { GET } = await import('../app/api/cron/update-prices/route.ts');

beforeEach(() => {
  Object.assign(globalThis.__keeperTest, { writes: 0, signs: 0, receipts: 0, receiptStatus: 'success', fetches: 0 });
  delete process.env.CRON_SECRET;
  process.env.DEPLOYER_PRIVATE_KEY = 'test-only-placeholder';
  globalThis.fetch = async () => {
    globalThis.__keeperTest.fetches++;
    return Response.json({ lighter: { usd: 2 }, ethereum: { usd: 2000 } });
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  hooks.deregister();
  delete globalThis.__keeperTest;
});

test('missing or blank secret fails closed before signing or network I/O', async () => {
  for (const secret of [undefined, '', '   ']) {
    if (secret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = secret;
    const res = await GET(new Request('http://localhost/api/cron/update-prices'));
    assert.equal(res.status, 503);
  }
  assert.equal(globalThis.__keeperTest.signs, 0);
  assert.equal(globalThis.__keeperTest.fetches, 0);
  assert.equal(globalThis.__keeperTest.writes, 0);
});
test('missing and incorrect credentials cannot trigger a write', async () => {
  process.env.CRON_SECRET = 'test-secret';
  for (const auth of ['', 'Bearer wrong']) {
    const res = await GET(new Request('http://localhost', { headers: { authorization: auth } }));
    assert.equal(res.status, 401);
  }
  assert.equal(globalThis.__keeperTest.signs, 0);
  assert.equal(globalThis.__keeperTest.writes, 0);
});
test('authorized updates await successful receipts', async () => {
  process.env.CRON_SECRET = 'test-secret';
  const res = await GET(new Request('http://localhost', { headers: { authorization: 'Bearer test-secret' } }));
  assert.equal(res.status, 200);
  assert.equal(globalThis.__keeperTest.writes, 4);
  assert.equal(globalThis.__keeperTest.receipts, 4);
});
test('reverted feed transaction stops before the swapper write', async () => {
  process.env.CRON_SECRET = 'test-secret';
  globalThis.__keeperTest.receiptStatus = 'reverted';
  await assert.rejects(GET(new Request('http://localhost', { headers: { authorization: 'Bearer test-secret' } })), /feed update reverted/);
  assert.equal(globalThis.__keeperTest.writes, 1);
});
test('nonpositive, nonfinite and unsafe prices never reach signing transactions', async () => {
  process.env.CRON_SECRET = 'test-secret';
  for (const usd of [0, -1, Infinity, NaN, 1e20, 1e-12]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ lighter: { usd }, ethereum: { usd } }) });
    await GET(new Request('http://localhost', { headers: { authorization: 'Bearer test-secret' } }));
  }
  assert.equal(globalThis.__keeperTest.writes, 0);
});
