import manifestJson from "../../deployments/lighter-devnet.json";
import type { LuminaDeployment } from "../../lib/deployments";

export const fake = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;

export const POOL = fake(0x100);
export const ORACLE = fake(0x101);
export const DATA_PROVIDER = fake(0x102);
export const GUARD = fake(0x103);
export const STRATEGY = fake(0x104);
export const PAIR_USDC_WETH = fake(0x200);
export const PAIR_WETH_USDC = fake(0x201);
export const DUAL_USDC_WETH = fake(0x300);
export const DUAL_WETH_USDC = fake(0x301);

/** The vendored template with every address the UI reads filled in (not loader-validated). */
export function filledDeployment(toDeployment: (m: never) => LuminaDeployment): LuminaDeployment {
  const m = structuredClone(manifestJson) as typeof manifestJson & Record<string, unknown>;
  const set = (key: string, address: string) => {
    (m.contracts as Record<string, { address: string | null }>)[key].address = address;
  };
  set("pool", POOL);
  set("aaveOracle", ORACLE);
  set("poolDataProvider", DATA_PROVIDER);
  set("priceGuard", GUARD);
  set("reserveInterestRateStrategy", STRATEGY);
  m.markets.core.forEach((c, i) => {
    (c as { aToken: string | null }).aToken = fake(0x400 + i);
    (c as { variableDebtToken: string | null }).variableDebtToken = fake(0x500 + i);
  });
  (m.markets.isolated[0] as { pair: string | null }).pair = PAIR_USDC_WETH;
  (m.markets.isolated[1] as { pair: string | null }).pair = PAIR_WETH_USDC;
  (m.oracle.dualOracles[0] as { address: string | null }).address = DUAL_USDC_WETH;
  (m.oracle.dualOracles[1] as { address: string | null }).address = DUAL_WETH_USDC;
  (m as { status: string }).status = "deployed";
  return toDeployment(m as never);
}

export const USDC = manifestJson.assets.USDC.address as `0x${string}`;
export const WETH = manifestJson.assets.WETH.address as `0x${string}`;
