/** Decode a write into a compact preview before the wallet prompt. */

export type TxPreviewArg = { name: string; value: string };

export type TxPreview = {
  functionName: string;
  to: string;
  args: TxPreviewArg[];
};

function stringifyArg(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(stringifyArg).join(", ");
  if (value === null || value === undefined) return "—";
  return String(value);
}

export function describeWrite(input: {
  address: string;
  functionName: string;
  args?: readonly unknown[];
  abi?: readonly { name?: string; type?: string; inputs?: readonly { name?: string }[] }[];
}): TxPreview {
  const fragment = input.abi?.find(
    (item) => item.type === "function" && item.name === input.functionName
  );
  const names = fragment?.inputs?.map((inputArg) => inputArg.name || "arg") ?? [];
  const args = (input.args ?? []).map((value, i) => ({
    name: names[i] || `arg${i}`,
    value: stringifyArg(value),
  }));
  return {
    functionName: input.functionName,
    to: input.address,
    args,
  };
}
