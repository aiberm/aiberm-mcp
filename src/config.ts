export interface Config {
  baseUrl: string;
  accessToken: string;
  userId: string;
  quotaPerUnit: number;
  httpHost: string;
  httpPort: number;
  timeoutMs: number;
}

/** New API's default QuotaPerUnit: 500000 quota units = 1 USD. */
export const DEFAULT_QUOTA_PER_UNIT = 500_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    baseUrl: parseBaseUrl(env.NEW_API_BASE_URL),
    accessToken: parseAccessToken(env.NEW_API_ACCESS_TOKEN),
    userId: parseUserId(env.NEW_API_USER_ID),
    quotaPerUnit: parseQuotaPerUnit(env.NEW_API_QUOTA_PER_UNIT),
    httpHost: parseHttpHost(env.MCP_HTTP_HOST),
    httpPort: parsePort(env.PORT),
    timeoutMs: 30_000,
  };
}

export function wantsHttp(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes("--http") || env.MCP_TRANSPORT === "http";
}

function parseBaseUrl(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    throw new ConfigError("NEW_API_BASE_URL is required (for example https://aiberm.com)");
  }
  if (/\s/.test(raw)) {
    throw new ConfigError("NEW_API_BASE_URL must not contain whitespace");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("NEW_API_BASE_URL must be an http(s) origin");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError("NEW_API_BASE_URL must use http or https");
  }
  if (url.username || url.password) {
    throw new ConfigError("NEW_API_BASE_URL must not include credentials");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ConfigError("NEW_API_BASE_URL must be an origin such as https://aiberm.com, without a path");
  }
  if (url.search || url.hash) {
    throw new ConfigError("NEW_API_BASE_URL must not include a query or hash");
  }
  return url.origin;
}

function parseAccessToken(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new ConfigError("NEW_API_ACCESS_TOKEN is required");
  }
  if (value !== value.trim() || /[\r\n]/.test(value) || value.length > 4096) {
    throw new ConfigError("NEW_API_ACCESS_TOKEN is invalid");
  }
  return value;
}

function parseUserId(value: string | undefined): string {
  const raw = value?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new ConfigError("NEW_API_USER_ID must be the numeric user id");
  }
  return raw;
}

function parseQuotaPerUnit(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_QUOTA_PER_UNIT;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError("NEW_API_QUOTA_PER_UNIT must be a positive number");
  }
  return parsed;
}

function parseHttpHost(value: string | undefined): string {
  const host = value?.trim() || "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
    throw new ConfigError("MCP_HTTP_HOST must be 127.0.0.1, localhost, or ::1");
  }
  return host;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 3000;
  }
  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigError("PORT must be an integer from 0 to 65535");
  }
  const port = Number(value);
  if (port > 65535) {
    throw new ConfigError("PORT must be an integer from 0 to 65535");
  }
  return port;
}
