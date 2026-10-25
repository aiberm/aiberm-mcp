import { quotaToUsd, unwrapData, withQuotaUsd } from "./quota.js";
import { isRecord, redactSecrets } from "./redact.js";

const BALANCE_NOTE =
  "quota is the remaining balance in New API quota units, not a lifetime grant. used_quota is cumulative consumption. USD fields divide quota by quota_per_unit (default 500000 = $1).";

export function presentSelf(body: unknown, quotaPerUnit: number, accessToken?: string): unknown {
  const enriched = withQuotaUsd(redactSecrets(body, accessToken), quotaPerUnit);
  if (!isRecord(enriched)) return enriched;
  return {
    ...enriched,
    quota_per_unit: quotaPerUnit,
    balance_note: BALANCE_NOTE,
  };
}

export function presentBalance(body: unknown, quotaPerUnit: number): Record<string, unknown> {
  const data = unwrapData(body);
  if (!isRecord(data)) {
    return { quota_per_unit: quotaPerUnit, balance_note: BALANCE_NOTE, raw: data ?? null };
  }
  const result: Record<string, unknown> = {
    user_id: data.id ?? null,
    username: data.username ?? null,
    display_name: data.display_name ?? null,
    group: data.group ?? null,
    status: data.status ?? null,
    request_count: data.request_count ?? null,
    quota_per_unit: quotaPerUnit,
    balance_note: BALANCE_NOTE,
  };
  if (typeof data.quota === "number") {
    result.quota = data.quota;
    result.quota_usd = quotaToUsd(data.quota, quotaPerUnit);
  }
  if (typeof data.used_quota === "number") {
    result.used_quota = data.used_quota;
    result.used_quota_usd = quotaToUsd(data.used_quota, quotaPerUnit);
  }
  return result;
}

export function presentPayload(body: unknown, quotaPerUnit: number, accessToken?: string): unknown {
  return withQuotaUsd(redactSecrets(body, accessToken), quotaPerUnit);
}
