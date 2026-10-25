import { McpServer } from "@modelcontextprotocol/server";
import type { NewApiClient } from "./client.js";
import { registerTools } from "./tools.js";

export const SERVER_NAME = "aiberm-mcp";
export const SERVER_VERSION = "1.0.0";

export interface ServerDeps {
  client: NewApiClient;
  quotaPerUnit: number;
  accessToken?: string;
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, deps);
  return server;
}
