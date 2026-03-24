/**
 * Parse blockchain/wallet error messages into user-friendly strings.
 */
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
  if (msg.includes("execution reverted")) {
    // Try to extract revert reason
    const match = msg.match(/reason:\s*(.+?)(?:\n|$)/);
    if (match) return `Contract error: ${match[1].slice(0, 80)}`;
    return "Transaction reverted by the contract";
  }
  if (msg.includes("nonce")) {
    return "Nonce error — try resetting your wallet activity";
  }

  return msg.slice(0, 100) || "Unknown error";
}
