#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { NewApiClient } from "./client.js";
import { ConfigError, loadConfig, wantsHttp } from "./config.js";
import { startHttpServer } from "./http.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    const message = error instanceof ConfigError || error instanceof Error ? error.message : "Invalid configuration";
    console.error(`aiberm-mcp: ${message}`);
    process.exit(1);
  }

  const client = new NewApiClient(config);
  const factory = () =>
    createServer({
      client,
      quotaPerUnit: config.quotaPerUnit,
      accessToken: config.accessToken,
    });

  if (wantsHttp(process.argv, process.env)) {
    const running = await startHttpServer(factory, { host: config.httpHost, port: config.httpPort });
    const shutdown = () => {
      void running.close().then(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  console.error("aiberm-mcp stdio ready");
  serveStdio(factory);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "failed to start";
  console.error(`aiberm-mcp: ${message}`);
  process.exit(1);
});
