const SECRET_FIELD_NAMES = new Set([
  "key",
  "access_token",
  "refresh_token",
  "password",
  "passwd",
  "secret",
  "api_key",
  "authorization",
]);

const SK_SECRET = /sk-[A-Za-z0-9_-]{16,}/g;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMaskedSecret(value: string): boolean {
  return value.includes("****");
}

export function redactString(value: string, accessToken?: string): string {
  let out = value;
  if (accessToken && accessToken.length > 0) {
    out = out.split(accessToken).join("[redacted]");
  }
  return out.replace(SK_SECRET, "sk-[redacted]");
}

/**
 * Drop unmasked credential fields and sk- secrets from an upstream JSON value.
 * Masked token keys (they contain `****`) are kept so users can tell tokens apart.
 */
export function redactSecrets(value: unknown, accessToken?: string): unknown {
  if (typeof value === "string") {
    return redactString(value, accessToken);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, accessToken));
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && SECRET_FIELD_NAMES.has(key.toLowerCase()) && !isMaskedSecret(child)) {
      out[key] = "***";
      continue;
    }
    out[key] = redactSecrets(child, accessToken);
  }
  return out;
}

export function sanitizeErrorText(message: string, accessToken?: string): string {
  return redactString(message, accessToken).slice(0, 500);
}
