import { roundUsd } from "./quota.js";
import { isRecord } from "./redact.js";

export interface PricingSummaryOptions {
  model?: string;
  group?: string;
  limit?: number;
  quotaPerUnit: number;
}

export function summarizePricing(body: unknown, options: PricingSummaryOptions): Record<string, unknown> {
  if (!isRecord(body)) {
    return { models: [], model_count: 0, returned: 0 };
  }
  const models = Array.isArray(body.data) ? body.data.filter(isRecord) : [];
  const groupRatio = numberRecord(body.group_ratio);
  const appliedRatio = resolveGroupRatio(groupRatio, options.group);
  const filtered = models.filter((model) => matchesModel(model, options.model) && matchesGroup(model, options.group));
  filtered.sort((a, b) => modelName(a).localeCompare(modelName(b)));
  const limit = options.limit ?? (options.model ? 50 : 25);
  const page = filtered.slice(0, limit);

  return {
    quota_per_unit: options.quotaPerUnit,
    group: options.group ?? null,
    group_ratio_applied: appliedRatio,
    group_ratio: body.group_ratio ?? {},
    usable_group: body.usable_group ?? {},
    auto_groups: body.auto_groups ?? [],
    pricing_version: body.pricing_version ?? null,
    vendors: compactVendors(body.vendors),
    model_count: filtered.length,
    returned: page.length,
    truncated: filtered.length > page.length,
    price_note:
      "quota_type 0 prices are USD per 1M tokens: model_ratio * group_ratio * (1000000 / quota_per_unit). Output multiplies by completion_ratio. quota_type 1 is USD per request (model_price * group_ratio). Pass group to apply that group's ratio; otherwise the ratio used here is 1.",
    models: page.map((model) => compactModel(model, appliedRatio, options.quotaPerUnit)),
  };
}

function compactModel(model: Record<string, unknown>, groupRatio: number, quotaPerUnit: number): Record<string, unknown> {
  const quotaType = typeof model.quota_type === "number" ? model.quota_type : 0;
  const modelRatio = numberOrZero(model.model_ratio);
  const completionRatio = numberOrZero(model.completion_ratio);
  const summary: Record<string, unknown> = {
    model_name: modelName(model),
    quota_type: quotaType,
    billing: quotaType === 1 ? "per_request" : "per_token",
    enable_groups: model.enable_groups ?? [],
  };
  if (typeof model.description === "string" && model.description) {
    summary.description = model.description.slice(0, 180);
  }
  if (typeof model.vendor_id === "number") summary.vendor_id = model.vendor_id;
  if (typeof model.owner_by === "string" && model.owner_by) summary.owner_by = model.owner_by;
  if (typeof model.tags === "string" && model.tags) summary.tags = model.tags;
  if (Array.isArray(model.supported_endpoint_types)) {
    summary.supported_endpoint_types = model.supported_endpoint_types;
  }
  if (quotaType === 1) {
    summary.price_usd_per_request = roundUsd(numberOrZero(model.model_price) * groupRatio);
  } else {
    const input = roundUsd(modelRatio * groupRatio * (1_000_000 / quotaPerUnit));
    summary.input_usd_per_million = input;
    summary.output_usd_per_million = roundUsd(input * completionRatio);
    summary.model_ratio = model.model_ratio ?? 0;
    summary.completion_ratio = model.completion_ratio ?? 0;
    copyRatio(summary, "cache_usd_per_million", model.cache_ratio, input);
    copyRatio(summary, "cache_write_usd_per_million", model.create_cache_ratio, input);
    copyRatio(summary, "image_usd_per_million", model.image_ratio, input);
  }
  if (typeof model.billing_mode === "string" && model.billing_mode) {
    summary.billing_mode = model.billing_mode;
  }
  if (typeof model.billing_expr === "string" && model.billing_expr) {
    summary.billing_expr = model.billing_expr.slice(0, 200);
  }
  return summary;
}

function copyRatio(target: Record<string, unknown>, key: string, ratio: unknown, inputUsd: number): void {
  if (typeof ratio === "number" && Number.isFinite(ratio)) {
    target[key] = roundUsd(inputUsd * ratio);
  }
}

function matchesModel(model: Record<string, unknown>, filter: string | undefined): boolean {
  if (!filter) return true;
  return modelName(model).toLowerCase().includes(filter.toLowerCase());
}

function matchesGroup(model: Record<string, unknown>, group: string | undefined): boolean {
  if (!group) return true;
  const groups = model.enable_groups;
  if (!Array.isArray(groups) || groups.length === 0) return true;
  return groups.some((item) => item === group || item === "all");
}

function modelName(model: Record<string, unknown>): string {
  return typeof model.model_name === "string" ? model.model_name : "";
}

function compactVendors(value: unknown): { id: number; name: string }[] {
  if (!Array.isArray(value)) return [];
  const vendors: { id: number; name: string }[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "number" || typeof item.name !== "string") continue;
    vendors.push({ id: item.id, name: item.name });
  }
  return vendors;
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "number" && Number.isFinite(child)) out[key] = child;
  }
  return out;
}

function resolveGroupRatio(ratios: Record<string, number>, group: string | undefined): number {
  if (!group) return 1;
  const ratio = ratios[group];
  return typeof ratio === "number" ? ratio : 1;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
