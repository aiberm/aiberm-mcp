import { isRecord } from "./redact.js";

const QUOTA_FIELDS = ["quota", "used_quota", "remain_quota", "aff_quota", "aff_history_quota"] as const;

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function quotaToUsd(quota: number, quotaPerUnit: number): number {
  return roundUsd(quota / quotaPerUnit);
}

/** Add `<field>_usd` next to known quota fields. Raw quota values stay in place. */
export function withQuotaUsd(value: unknown, quotaPerUnit: number): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => withQuotaUsd(item, quotaPerUnit));
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = withQuotaUsd(child, quotaPerUnit);
  }
  for (const field of QUOTA_FIELDS) {
    const raw = out[field];
    const usdKey = `${field}_usd`;
    if (typeof raw === "number" && Number.isFinite(raw) && !(usdKey in value)) {
      out[usdKey] = quotaToUsd(raw, quotaPerUnit);
    }
  }
  return out;
}

export function unwrapData(body: unknown): unknown {
  if (isRecord(body) && "data" in body) {
    return body.data;
  }
  return body;
}
