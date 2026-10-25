import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { NewApiClient } from "../src/client.ts";
import { startHttpServer } from "../src/http.ts";
import { createServer } from "../src/server.ts";
import { USER_TOOL_NAMES } from "../src/tools.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "super-secret-token";

const config = {
  baseUrl: "https://aiberm.com",
  accessToken: SECRET,
  userId: "42",
  quotaPerUnit: 500_000,
  httpHost: "127.0.0.1",
  httpPort: 0,
  timeoutMs: 1000,
};

function jsonResult(result: { content?: unknown; isError?: boolean }): unknown {
  const content = result.content;
  assert.ok(Array.isArray(content));
  const block = content[0] as { type?: string; text?: string };
  assert.equal(block.type, "text");
  return JSON.parse(block.text ?? "");
}

describe("tool registration", () => {
  it("lists only the curated user tools", async () => {
    const handler = createMcpHandler(() => createServer({ client: new NewApiClient(config), quotaPerUnit: 500_000 }));
    const transport = new StreamableHTTPClientTransport(new URL("http://tools.local/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    const client = new Client({ name: "aiberm-mcp-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...USER_TOOL_NAMES].sort());
    const blocked = /channel|redemption|option|admin|deploy|vendor|all_user|system_task/i;
    for (const name of names) assert.equal(blocked.test(name), false, name);
    await client.close();
  });

  it("calls get_balance through the user client", async () => {
    let authorization = "";
    let userHeader = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      authorization = headers.get("authorization") ?? "";
      userHeader = headers.get("new-api-user") ?? "";
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 42,
            username: "ada",
            group: "default",
            quota: 1_500_000,
            used_quota: 500_000,
            request_count: 9,
            key: "sk-should-not-leak-0123456789",
          },
        }),
        { status: 200 },
      );
    };
    const handler = createMcpHandler(() =>
      createServer({
        client: new NewApiClient(config, fetchImpl),
        quotaPerUnit: 500_000,
        accessToken: SECRET,
      }),
    );
    const transport = new StreamableHTTPClientTransport(new URL("http://tools.local/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    const client = new Client({ name: "aiberm-mcp-test", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
    await client.connect(transport);
    const result = await client.callTool({ name: "get_balance", arguments: {} });
    const balance = jsonResult(result) as { quota_usd: number; used_quota_usd: number };
    assert.equal(balance.quota_usd, 3);
    assert.equal(balance.used_quota_usd, 1);
    assert.equal(JSON.stringify(balance).includes(SECRET), false);
    assert.equal(JSON.stringify(balance).includes("sk-should-not-leak"), false);
    assert.equal(authorization, `Bearer ${SECRET}`);
    assert.equal(userHeader, "42");

    const badRange = await client.callTool({
      name: "get_usage_flow",
      arguments: { start_timestamp: 20, end_timestamp: 10 },
    });
    assert.equal(badRange.isError, true);
    await client.close();
  });
});

describe("http transport", () => {
  it("serves tools/list on the loopback streamable HTTP endpoint", async () => {
    const running = await startHttpServer(() => createServer({ client: new NewApiClient(config), quotaPerUnit: 500_000 }), {
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const client = new Client({ name: "aiberm-mcp-http", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
      const transport = new StreamableHTTPClientTransport(new URL(running.url));
      await client.connect(transport);
      const listed = await client.listTools();
      assert.equal(listed.tools.length, USER_TOOL_NAMES.length);
      await client.close();

      const forbidden = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: running.port,
            path: "/mcp",
            method: "POST",
            headers: { host: "evil.example", origin: "https://evil.example", "content-type": "application/json" },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end("{}");
      });
      assert.equal(forbidden, 403);
    } finally {
      await running.close();
    }
  });
});

describe("stdio transport", () => {
  it("starts with env set and lists user tools", async () => {
    const stderr: Buffer[] = [];
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string" && !key.startsWith("NEW_API_")) env[key] = value;
    }
    env.NEW_API_BASE_URL = "https://aiberm.com";
    env.NEW_API_ACCESS_TOKEN = SECRET;
    env.NEW_API_USER_ID = "42";

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts"],
      cwd: root,
      env,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    const client = new Client({ name: "aiberm-mcp-stdio", version: "1.0.0" });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [...USER_TOOL_NAMES].sort(),
    );
    await client.close();
    const logs = Buffer.concat(stderr).toString("utf8");
    assert.match(logs, /stdio ready/);
    assert.equal(logs.includes(SECRET), false);
  });

  it("exits when required env is missing and does not print a token", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", NEW_API_ACCESS_TOKEN: SECRET },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    const exited = once(child, "exit");
    child.stdin?.end();
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    const [code] = (await exited) as [number | null];
    clearTimeout(timer);
    const stdout = Buffer.concat(out).toString("utf8");
    const stderr = Buffer.concat(err).toString("utf8");
    assert.notEqual(code, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /NEW_API_BASE_URL/);
    assert.equal(stderr.includes(SECRET), false);
  });
});
