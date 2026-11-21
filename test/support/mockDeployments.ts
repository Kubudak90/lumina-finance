import { filledDeployment } from "./deployment";

/** vi.mock factory body for `@/lib/deployments` with a filled ("deployed") manifest. */
export async function mockDeployments(importOriginal: () => Promise<unknown>) {
  const actual = (await importOriginal()) as typeof import("@/lib/deployments");
  // Built with the ORIGINAL toDeployment: importing the mocked module here would deadlock.
  const LUMINA = filledDeployment(actual.toDeployment as never);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return {
    ...actual,
    LUMINA,
    DEPLOYMENTS: { [LUMINA.chainId]: LUMINA },
    getDeployment: () => LUMINA,
    isDeployed: () => true,
    contractAddress: (_: number, key: keyof typeof LUMINA.contracts) => LUMINA.contracts[key],
    getCoreMarketByAsset: (asset: string) => LUMINA.coreMarkets.find((m) => same(m.asset, asset)),
    getCoreMarketBySymbol: (symbol: string) => LUMINA.coreMarkets.find((m) => same(m.symbol, symbol)),
  };
}
