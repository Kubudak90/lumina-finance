/**
 * Parse blockchain/wallet error messages into user-friendly strings.
 *
 * Handles:
 *  - Wallet-level errors (rejection, insufficient funds, nonce)
 *  - Aave V3 numeric revert codes (e.g. "43" -> "You have no aToken balance for this asset")
 *  - Generic execution reverts with extracted reason strings
 */

// Aave V3 error codes (subset most relevant to user-facing flows).
// Source: @aave/core-v3 contracts/protocol/libraries/helpers/Errors.sol
const AAVE_ERRORS: Record<string, string> = {
  "1": "Caller is not a pool admin",
  "23": "Amount exceeds the maximum allowed",
  "26": "User has no debt of this type",
  "27": "Borrow allowance has not been delegated",
  "28": "Stable borrowing not enabled for this reserve",
  "30": "Borrowing not enabled for this reserve",
  "31": "User has no debt to repay",
  "32": "Your collateral balance is zero",
  "33": "Health factor is below the liquidation threshold",
  "34": "Collateral cannot cover the new borrow",
  "35": "Stable interest rate is not active for this user",
  "36": "Collateral cannot cover the new borrow",
  "39": "Reserve already initialized",
  "42": "Inconsistent ATokens balance",
  "43": "You have no balance of this asset to use as collateral. Supply first.",
  "44": "Conditions to rebalance interest rate are not met",
  "45": "Reserve is paused",
  "47": "Borrow cap exceeded",
  "48": "Supply cap exceeded",
  "50": "Health factor is not below the liquidation threshold",
  "51": "Collateral balance is zero",
  "52": "Health factor is lower than liquidation threshold",
  "53": "Specified currency is not borrowable in isolation mode",
  "54": "Borrow cap exceeded",
  "55": "Specified currency is not collateral in isolation mode",
  "56": "Asset is not borrowable in isolation mode",
  "57": "Asset is in EMode category but borrow cap is exceeded",
  "58": "EMode category is invalid",
  "59": "Inconsistent EMode category",
  "60": "Price oracle sentinel is checking conditions",
  "62": "Asset is frozen",
  "65": "User cannot withdraw more than the available balance",
  "82": "Asset is in isolation mode",
};

function parseAaveError(msg: string): string | null {
  // viem typically includes "execution reverted: <code>" or "reverted with reason string '<code>'"
  // Aave V3 errors are simple numeric codes (e.g. "43", "23")
  const reasonMatch =
    msg.match(/execution reverted:\s*([0-9]{1,3})\b/) ||
    msg.match(/reason(?:\s+string)?\s*['"]?([0-9]{1,3})['"]?/i) ||
    msg.match(/reverted with reason string\s*['"]?([0-9]{1,3})['"]?/i);

  if (!reasonMatch) return null;
  const code = reasonMatch[1];
  return AAVE_ERRORS[code] ?? `Aave error code ${code}`;
}

export function parseErrorMessage(error: Error | null | undefined): string {
  if (!error) return "Unknown error";
  const msg = error.message || "";

  if (msg.includes("user rejected") || msg.includes("User denied") || msg.includes("User rejected")) {
    return "Transaction rejected by user";
  }
  if (msg.includes("insufficient funds")) {
    return "Insufficient funds for transaction";
  }
  if (msg.includes("exceeds balance")) {
    return "Amount exceeds your balance";
  }

  // Aave V3 numeric revert code — check first, before generic revert handling
  const aave = parseAaveError(msg);
  if (aave) return aave;

  if (msg.includes("execution reverted") || msg.includes("reverted")) {
    // Try to extract free-form revert reason
    const match = msg.match(/reason:\s*(.+?)(?:\n|$)/);
    if (match) return `Contract error: ${match[1].slice(0, 80)}`;
    return "Transaction reverted by the contract";
  }
  if (msg.includes("nonce")) {
    return "Nonce error — try resetting your wallet activity";
  }

  return msg.slice(0, 120) || "Unknown error";
}
