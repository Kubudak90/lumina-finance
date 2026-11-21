import { describe, expect, it } from "vitest";
import { readOnlyAccountExistence } from "./existence";

const base = {
  l1Initialized: true,
  userAddress: "0xabc",
  accountIndex: 7,
  accountsPending: false,
  accountsSuccess: true,
  accountsError: false,
  accountsErrorStatus: undefined,
};

describe("read-only Lighter account state (Codex #13)", () => {
  it("an existing account is ReadOnly, never KeysDontMatch or Exists", () => {
    expect(readOnlyAccountExistence(base)).toBe("ReadOnly");
  });

  it("keeps the public states", () => {
    expect(readOnlyAccountExistence({ ...base, l1Initialized: false })).toBe("Deciding");
    expect(readOnlyAccountExistence({ ...base, userAddress: "" })).toBe("NoWallet");
    expect(readOnlyAccountExistence({ ...base, accountIndex: 0, accountsSuccess: false, accountsError: true, accountsErrorStatus: 400 })).toBe("ShouldDeposit");
  });
});
