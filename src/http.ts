import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";

const MAX_BODY_BYTES = 1024 * 1024;

const FORBIDDEN_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "expect",
  "te",
  "trailer",
]);

export interface HttpListenOptions {
  host: string;
  port: number;
}

export interface RunningHttpServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startHttpServer(
  factory: () => McpServer,
  options: HttpListenOptions,
): Promise<RunningHttpServer> {
  const handler = createMcpHandler(factory);
  const server = createHttpServer((req, res) => {
    void handleRequest(req, res, handler.fetch.bind(handler));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP server did not bind a TCP port");
  }
  const hostForUrl = options.host.includes(":") ? `[${options.host}]` : options.host;
  const url = `http://${hostForUrl}:${address.port}/mcp`;
  console.error(`aiberm-mcp http listening on ${url}`);

  return {
    url,
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  fetchHandler: (request: Request) => Promise<Response>,
): Promise<void> {
  if (!loopbackHostHeader(req.headers.host)) {
    res.writeHead(403, { "content-type": "text/plain" }).end("forbidden host");
    return;
  }
  const origin = headerValue(req.headers.origin);
  if (origin && !loopbackOrigin(origin)) {
    res.writeHead(403, { "content-type": "text/plain" }).end("forbidden origin");
    return;
  }
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (requestUrl.pathname !== "/mcp") {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }

  try {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined || FORBIDDEN_HEADERS.has(key.toLowerCase())) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else {
        headers.set(key, value);
      }
    }
    const response = await fetchHandler(
      new Request(requestUrl, {
        method: req.method,
        headers,
        body: body === undefined ? undefined : new Uint8Array(body),
      }),
    );
    await writeResponse(res, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    if (!res.headersSent) {
      res.writeHead(400, { "content-type": "text/plain" }).end(message.slice(0, 200));
    } else {
      res.end();
    }
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function loopbackHostHeader(host: string | undefined): boolean {
  if (!host) return false;
  const trimmed = host.trim().toLowerCase();
  let hostname = trimmed;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    hostname = end === -1 ? trimmed : trimmed.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(trimmed) || trimmed.startsWith("localhost:")) {
    hostname = trimmed.slice(0, trimmed.lastIndexOf(":"));
  }
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function loopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}
