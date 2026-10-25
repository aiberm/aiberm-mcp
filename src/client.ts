import type { Config } from "./config.js";
import { assertUserPath } from "./paths.js";
import { redactSecrets, sanitizeErrorText } from "./redact.js";

export type QueryValue = string | number | boolean | undefined;

export class NewApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "NewApiError";
    this.status = status;
  }
}

export class NewApiClient {
  constructor(
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get(path: string, query?: Record<string, QueryValue>): Promise<unknown> {
    const pathname = assertUserPath(path);
    const url = new URL(pathname, this.config.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.config.accessToken}`,
          "New-Api-User": this.config.userId,
          "User-Agent": "aiberm-mcp/1.0",
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      throw new NewApiError(0, sanitizeErrorText(message, this.config.accessToken));
    }

    const text = await response.text();
    const body = parseBody(text, this.config.accessToken);
    if (!response.ok) {
      throw new NewApiError(response.status, errorMessage(body, response.status, this.config.accessToken));
    }
    if (isFailure(body)) {
      throw new NewApiError(response.status, errorMessage(body, response.status, this.config.accessToken));
    }
    return redactSecrets(body, this.config.accessToken);
  }
}

function parseBody(text: string, accessToken: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { raw: sanitizeErrorText(trimmed, accessToken) };
  }
}

function isFailure(body: unknown): boolean {
  return typeof body === "object" && body !== null && "success" in body && (body as { success?: unknown }).success === false;
}

function errorMessage(body: unknown, status: number, accessToken: string): string {
  let message = `New API request failed (HTTP ${status})`;
  if (typeof body === "object" && body !== null && "message" in body) {
    const upstream = (body as { message?: unknown }).message;
    if (typeof upstream === "string" && upstream.trim()) {
      message = upstream.trim();
    }
  }
  return sanitizeErrorText(message, accessToken);
}
