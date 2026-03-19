import { useReadContracts, useAccount } from "wagmi";
import { DEBT_TOKEN_ABI, ERC20_ABI, ADDRESSES } from "@/lib/contracts";
import { MARKETS } from "@/lib/constants";

export interface UserMarketPosition {
  asset: `0x${string}`;
  symbol: string;
  supplied: bigint;    // lToken balance
  borrowed: bigint;    // debtToken balance
  collateral: bigint;  // adapter deposit balance
}

export function useUserPosition() {
  const { address } = useAccount();

  // We need lToken balances, debtToken balances for each market
  // For MVP, we read these from the contracts
  // In production, the LendingPool would expose a getUserPosition view

  const enabled = !!address;

  const result = useReadContracts({
    contracts: address
      ? MARKETS.flatMap((m) => [
          // Wallet balance of underlying token
          {
            address: m.asset,
            abi: ERC20_ABI,
            functionName: "balanceOf" as const,
            args: [address] as const,
          },
        ])
      : [],
    query: { enabled },
  });

  return {
    positions: [] as UserMarketPosition[], // Simplified for MVP — expand when contracts deployed
    isLoading: result.isLoading,
    isConnected: !!address,
  };
}
