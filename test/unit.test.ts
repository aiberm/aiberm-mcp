import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NewApiClient, NewApiError } from "../src/client.ts";
import { loadConfig, ConfigError } from "../src/config.ts";
import { loopbackHostHeader } from "../src/http.ts";
import { assertUserPath } from "../src/paths.ts";
import { presentBalance } from "../src/present.ts";
import { summarizePricing } from "../src/pricing.ts";
import { quotaToUsd } from "../src/quota.ts";
import { redactSecrets } from "../src/redact.ts";

const baseEnv = {
  NEW_API_BASE_URL: "https://aiberm.com",
  NEW_API_ACCESS_TOKEN: "dashboard-token",
  NEW_API_USER_ID: "42",
};

describe("config", () => {
  it("loads the required origin, token, and numeric user id", () => {
    const config = loadConfig(baseEnv);
    assert.equal(config.baseUrl, "https://aiberm.com");
    assert.equal(config.userId, "42");
    assert.equal(config.quotaPerUnit, 500_000);
    assert.equal(config.httpHost, "127.0.0.1");
    assert.equal(config.httpPort, 3000);
  });

  it("rejects missing and unsafe configuration without echoing the token", () => {
    assert.throws(() => loadConfig({}), ConfigError);
    assert.throws(() => loadConfig({ ...baseEnv, NEW_API_BASE_URL: "https://user:secret@aiberm.com" }), /credentials/);
    assert.throws(() => loadConfig({ ...baseEnv, NEW_API_BASE_URL: "https://aiberm.com/api" }), /origin/);
    assert.throws(() => loadConfig({ ...baseEnv, NEW_API_USER_ID: "ada" }), /numeric/);
    assert.throws(() => loadConfig({ ...baseEnv, NEW_API_ACCESS_TOKEN: "bad\ntoken" }), /invalid/);
    assert.throws(() => loadConfig({ ...baseEnv, MCP_HTTP_HOST: "0.0.0.0" }), /loopback|127\.0\.0\.1/);
    assert.throws(
      () => loadConfig({ NEW_API_ACCESS_TOKEN: "dashboard-token" }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.equal(error.message.includes("dashboard-token"), false);
        return true;
      },
    );
  });
});

describe("allowlist", () => {
  it("allows documented user paths and refuses admin paths", () => {
    assert.equal(assertUserPath("/api/user/self"), "/api/user/self");
    assert.equal(assertUserPath("/api/user/self/groups"), "/api/user/self/groups");
    assert.equal(assertUserPath("/api/pricing"), "/api/pricing");
    assert.equal(assertUserPath("/api/token/"), "/api/token/");
    assert.equal(assertUserPath("/api/token/15"), "/api/token/15");
    assert.equal(assertUserPath("/api/log/self"), "/api/log/self");
    for (const blocked of [
      "/api/channel/",
      "/api/user/",
      "/api/user/search",
      "/api/redemption/",
      "/api/option/",
      "/api/log/",
      "/api/log/stat",
      "/api/token/15/key",
      "/api/token/batch/keys",
      "/api/models/",
      "/api/group/",
      "https://aiberm.com/api/user/self",
    ]) {
      assert.throws(() => assertUserPath(blocked), /allowlist|Query strings/);
    }
  });
});

describe("redaction and quota", () => {
  it("masks full keys and sk- secrets but keeps masked keys", () => {
    const value = redactSecrets(
      {
        key: "sk-abcdefghijklmnopqrstuvwxyz",
        masked: { key: "abcd**********wxyz" },
        note: "leak sk-abcdefghijklmnopqrstuvwxyz and dashboard-token",
      },
      "dashboard-token",
    );
    assert.deepEqual(value, {
      key: "***",
      masked: { key: "abcd**********wxyz" },
      note: "leak sk-[redacted] and [redacted]",
    });
  });

  it("converts the default quota unit to USD", () => {
    assert.equal(quotaToUsd(500_000, 500_000), 1);
    assert.equal(quotaToUsd(250_000, 500_000), 0.5);
    const balance = presentBalance(
      { success: true, data: { id: 7, username: "ada", group: "default", quota: 1_000_000, used_quota: 500_000, request_count: 3 } },
      500_000,
    );
    assert.equal(balance.quota_usd, 2);
    assert.equal(balance.used_quota_usd, 1);
    assert.equal(balance.quota, 1_000_000);
  });
});

describe("pricing", () => {
  it("summarizes token and per-request prices for the selected group", () => {
    const summary = summarizePricing(
      {
        success: true,
        group_ratio: { default: 1, vip: 0.5 },
        usable_group: { default: "Default", vip: "VIP" },
        auto_groups: ["default"],
        vendors: [{ id: 1, name: "OpenAI", icon: "skip-me" }],
        data: [
          {
            model_name: "gpt-4o",
            quota_type: 0,
            model_ratio: 1.25,
            completion_ratio: 4,
            enable_groups: ["default", "vip"],
            description: "flagship",
          },
          { model_name: "dall-e-3", quota_type: 1, model_price: 0.04, enable_groups: ["default"] },
          { model_name: "hidden", quota_type: 0, model_ratio: 9, enable_groups: ["private"] },
        ],
      },
      { group: "vip", model: "gpt", quotaPerUnit: 500_000, limit: 10 },
    );
    assert.equal(summary.model_count, 1);
    const models = summary.models as Record<string, unknown>[];
    assert.equal(models[0]?.model_name, "gpt-4o");
    assert.equal(models[0]?.input_usd_per_million, 1.25);
    assert.equal(models[0]?.output_usd_per_million, 5);
    assert.deepEqual(summary.vendors, [{ id: 1, name: "OpenAI" }]);
  });
});

describe("client", () => {
  it("sends bearer auth and New-Api-User, and refuses admin paths before fetch", async () => {
    const seen: { url: string; authorization: string | null; user: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(input),
        authorization: headers.get("authorization"),
        user: headers.get("new-api-user"),
      });
      return new Response(JSON.stringify({ success: true, data: { quota: 500_000 } }), { status: 200 });
    };
    const client = new NewApiClient(
      {
        baseUrl: "https://aiberm.com",
        accessToken: "dashboard-token",
        userId: "42",
        quotaPerUnit: 500_000,
        httpHost: "127.0.0.1",
        httpPort: 0,
        timeoutMs: 1000,
      },
      fetchImpl,
    );
    await client.get("/api/user/self");
    assert.equal(seen[0]?.url, "https://aiberm.com/api/user/self");
    assert.equal(seen[0]?.authorization, "Bearer dashboard-token");
    assert.equal(seen[0]?.user, "42");
    await assert.rejects(client.get("/api/channel/"), /allowlist/);
    assert.equal(seen.length, 1);
  });

  it("turns success false into an error and strips the access token", async () => {
    const client = new NewApiClient(
      {
        baseUrl: "https://aiberm.com",
        accessToken: "dashboard-token",
        userId: "42",
        quotaPerUnit: 500_000,
        httpHost: "127.0.0.1",
        httpPort: 0,
        timeoutMs: 1000,
      },
      async () => new Response(JSON.stringify({ success: false, message: "invalid dashboard-token" }), { status: 200 }),
    );
    await assert.rejects(client.get("/api/pricing"), (error: unknown) => {
      assert.ok(error instanceof NewApiError);
      assert.equal(error.message.includes("dashboard-token"), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    });
  });
});

describe("http host check", () => {
  it("accepts loopback host headers only", () => {
    assert.equal(loopbackHostHeader("127.0.0.1:3000"), true);
    assert.equal(loopbackHostHeader("localhost"), true);
    assert.equal(loopbackHostHeader("[::1]:3000"), true);
    assert.equal(loopbackHostHeader("evil.example"), false);
    assert.equal(loopbackHostHeader(undefined), false);
  });
});
