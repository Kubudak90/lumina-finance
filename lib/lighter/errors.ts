const SECRET_PATTERN =
  /seed|private[_-]?key|\bprv\b|api[_-]?key|auth[_-]?token|authorization|signature|mnemonic|secret/i;

const SECRET_VALUE_PATTERN = /^(0x)?[0-9a-f]{32,}$/i;

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERN.test(value) || value.length > 96) return "[redacted]";
    return value;
  }
  if (typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactMessage(value.message) };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactForLog(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    out[key] = SECRET_PATTERN.test(key) ? "[redacted]" : redactForLog(nested, depth + 1);
  }
  return out;
}

function redactMessage(message: string): string {
  return message.replace(/(0x)?[0-9a-f]{32,}/gi, "[redacted]");
}

/** Host logger for Lighter. Never print seeds, API keys, or auth tokens. */
export function logLighterError(error: unknown, context?: string): void {
  if (context) {
    console.error("[lighter]", context, redactForLog(error));
    return;
  }
  console.error("[lighter]", redactForLog(error));
}
