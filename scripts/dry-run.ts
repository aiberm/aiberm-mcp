import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { NewApiClient } from "../src/client.ts";
import { createServer } from "../src/server.ts";
import { USER_TOOL_NAMES } from "../src/tools.ts";

const client = new NewApiClient({
  baseUrl: "https://aiberm.com",
  accessToken: "dry-run-token",
  userId: "1",
  quotaPerUnit: 500_000,
  httpHost: "127.0.0.1",
  httpPort: 0,
  timeoutMs: 1000,
});

const handler = createMcpHandler(() => createServer({ client, quotaPerUnit: 500_000 }));
const transport = new StreamableHTTPClientTransport(new URL("http://dry-run.local/mcp"), {
  fetch: (url, init) => handler.fetch(new Request(url, init)),
});
const mcp = new Client({ name: "aiberm-mcp-dry-run", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });

await mcp.connect(transport);
const listed = await mcp.listTools();
const names = new Set(listed.tools.map((tool) => tool.name));
const expected = new Set<string>(USER_TOOL_NAMES);
const missing = [...expected].filter((name) => !names.has(name));
const unexpected = [...names].filter((name) => !expected.has(name));
if (missing.length > 0 || unexpected.length > 0) {
  console.error(`tool list mismatch missing=${missing.join(",")} unexpected=${unexpected.join(",")}`);
  process.exit(1);
}
console.log([...names].sort().join("\n"));
await mcp.close();
