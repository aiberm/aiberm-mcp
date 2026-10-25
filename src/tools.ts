import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { NewApiClient } from "./client.js";
import { presentBalance, presentPayload, presentSelf } from "./present.js";
import { summarizePricing } from "./pricing.js";

export interface ToolDeps {
  client: NewApiClient;
  quotaPerUnit: number;
  accessToken?: string;
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const pageFields = {
  page: z.number().int().min(1).max(100_000).optional().describe("Page number. Sent as query p. Default 1."),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Page size. Sent as page_size. Default 20, maximum 100."),
};

const logFilterFields = {
  type: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Log type. 0 is all. 1 top-up, 2 consume, 3 manage, 4 system, 5 error, 6 refund."),
  start_timestamp: z.number().int().nonnegative().optional().describe("Range start, unix seconds, inclusive."),
  end_timestamp: z.number().int().nonnegative().optional().describe("Range end, unix seconds, inclusive."),
  model_name: z.string().max(200).optional().describe("Filter by model name."),
  token_name: z.string().max(200).optional().describe("Filter by API token name. Not the secret key."),
  group: z.string().max(100).optional().describe("Filter by the group charged for the request."),
  request_id: z.string().max(128).optional().describe("New API request id."),
  upstream_request_id: z.string().max(200).optional().describe("Upstream request id, when the instance stores one."),
};

export const USER_TOOL_NAMES = [
  "get_self",
  "get_balance",
  "get_self_groups",
  "get_models",
  "get_pricing",
  "list_tokens",
  "get_token",
  "get_token_auto_groups",
  "list_logs",
  "get_usage_stats",
  "get_usage_by_day",
  "get_usage_flow",
  "list_topups",
  "get_topup_info",
  "get_subscription",
  "list_subscription_plans",
  "get_affiliate",
  "get_checkin_status",
  "list_tasks",
  "list_drawings",
] as const;

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const call = binder();

  server.registerTool(
    "get_self",
    {
      title: "Current user",
      description:
        "Get the signed-in New API user: profile, group, remaining quota, used quota, and permissions. GET /api/user/self. quota is the remaining balance.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => call(() => deps.client.get("/api/user/self").then((body) => presentSelf(body, deps.quotaPerUnit, deps.accessToken))),
  );

  server.registerTool(
    "get_balance",
    {
      title: "Balance",
      description:
        "Get remaining quota and used quota for the signed-in user, with USD estimates. Uses GET /api/user/self. quota is the remaining balance; do not subtract used_quota from it.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => call(() => deps.client.get("/api/user/self").then((body) => presentBalance(body, deps.quotaPerUnit))),
  );

  server.registerTool(
    "get_self_groups",
    {
      title: "Usable groups",
      description:
        "List groups the signed-in user can use, with each group's ratio and description. GET /api/user/self/groups.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => call(() => deps.client.get("/api/user/self/groups")),
  );

  server.registerTool(
    "get_models",
    {
      title: "Available models",
      description:
        "List model names enabled for the signed-in user's groups. GET /api/user/models. Pass group to limit the list to one usable group, or auto for the auto-group set.",
      inputSchema: z.object({
        group: z.string().max(100).optional().describe("Optional group name, or auto."),
      }),
      annotations: READ_ONLY,
    },
    async ({ group }) => call(() => deps.client.get("/api/user/models", { group })),
  );

  server.registerTool(
    "get_pricing",
    {
      title: "Model pricing",
      description:
        "Get model prices for the signed-in user, plus usable groups and group ratios. GET /api/pricing. Results are filtered to groups the user can use. Pass model to search by name and group to price with that group's ratio. Prices are summarized in USD; the raw catalog is not dumped in full.",
      inputSchema: z.object({
        model: z.string().max(200).optional().describe("Case-insensitive substring of model_name."),
        group: z.string().max(100).optional().describe("Group whose ratio is applied to the displayed USD prices."),
        limit: z.number().int().min(1).max(100).optional().describe("Max models to return. Default 25, or 50 when model is set."),
      }),
      annotations: READ_ONLY,
    },
    async ({ model, group, limit }) =>
      call(() =>
        deps.client.get("/api/pricing").then((body) =>
          summarizePricing(body, { model, group, limit, quotaPerUnit: deps.quotaPerUnit }),
        ),
      ),
  );

  server.registerTool(
    "list_tokens",
    {
      title: "My API tokens",
      description:
        "List the signed-in user's relay API tokens. GET /api/token/, or GET /api/token/search when keyword is set. Keys are masked. This does not reveal full keys.",
      inputSchema: z.object({
        ...pageFields,
        keyword: z.string().max(200).optional().describe("Search the user's own tokens by keyword."),
      }),
      annotations: READ_ONLY,
    },
    async (args) =>
      call(() => {
        const query = { ...pageQuery(args), keyword: args.keyword };
        const path = args.keyword ? "/api/token/search" : "/api/token/";
        return deps.client.get(path, query).then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken));
      }),
  );

  server.registerTool(
    "get_token",
    {
      title: "One API token",
      description:
        "Get one of the signed-in user's relay API tokens by id. GET /api/token/{id}. The key is masked. This does not call the key-reveal endpoint.",
      inputSchema: z.object({
        id: z.number().int().positive().describe("Token id owned by the signed-in user."),
      }),
      annotations: READ_ONLY,
    },
    async ({ id }) =>
      call(() =>
        deps.client
          .get(`/api/token/${id}`)
          .then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken)),
      ),
  );

  server.registerTool(
    "get_token_auto_groups",
    {
      title: "Token auto groups",
      description:
        "List auto groups the signed-in user may assign to a token, and the max selection count. GET /api/token/auto-groups.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => call(() => deps.client.get("/api/token/auto-groups")),
  );

  server.registerTool(
    "list_logs",
    {
      title: "My usage logs",
      description:
        "List the signed-in user's usage logs. GET /api/log/self. Regular users only receive their own rows. Channel and username admin filters are not sent.",
      inputSchema: z.object({ ...pageFields, ...logFilterFields }),
      annotations: READ_ONLY,
    },
    async (args) =>
      call(() => {
        assertTimeRange(args.start_timestamp, args.end_timestamp);
        return deps.client
          .get("/api/log/self", { ...pageQuery(args), ...logQuery(args) })
          .then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken));
      }),
  );

  server.registerTool(
    "get_usage_stats",
    {
      title: "My usage stats",
      description:
        "Sum the signed-in user's quota use, plus recent RPM and TPM. GET /api/log/self/stat. quota in the response is consumption for the filter, not the wallet balance.",
      inputSchema: z.object(logFilterFields),
      annotations: READ_ONLY,
    },
    async (args) =>
      call(() => {
        assertTimeRange(args.start_timestamp, args.end_timestamp);
        return deps.client
          .get("/api/log/self/stat", logQuery(args))
          .then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken));
      }),
  );

  server.registerTool(
    "get_usage_by_day",
    {
      title: "Daily usage",
      description:
        "Get the signed-in user's quota usage aggregated by day. GET /api/data/self. Timestamps are unix seconds. The instance rejects ranges longer than its log window.",
      inputSchema: z.object({
        start_timestamp: logFilterFields.start_timestamp,
        end_timestamp: logFilterFields.end_timestamp,
      }),
      annotations: READ_ONLY,
    },
    async (args) =>
      call(() => {
        assertTimeRange(args.start_timestamp, args.end_timestamp);
        return deps.client
          .get("/api/data/self", args)
          .then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken));
      }),
  );

  server.registerTool(
    "get_usage_flow",
    {
      title: "Usage flow",
      description:
        "Get the signed-in user's quota flow inside a time range. GET /api/data/flow/self. Both timestamps are required unix seconds.",
      inputSchema: z.object({
        start_timestamp: z.number().int().positive().describe("Range start, unix seconds."),
        end_timestamp: z.number().int().positive().describe("Range end, unix seconds."),
      }),
      annotations: READ_ONLY,
    },
    async (args) =>
      call(() => {
        assertTimeRange(args.start_timestamp, args.end_timestamp);
        return deps.client
          .get("/api/data/flow/self", args)
          .then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken));
      }),
  );

  server.registerTool(
    "list_topups",
    {
      title: "My top-ups",
      description: "List the signed-in user's top-up records. GET /api/user/topup/self.",
      inputSchema: z.object({
        ...pageFields,
        keyword: z.string().max(200).optional().describe("Search the user's own top-up records."),
      }),
      annotations: READ_ONLY,
    },
    async (args) =>
      call(() =>
        deps.client
          .get("/api/user/topup/self", { ...pageQuery(args), keyword: args.keyword })
          .then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken)),
      ),
  );

  server.registerTool(
    "get_topup_info",
    {
      title: "Top-up info",
      description:
        "Get top-up display info for the signed-in user, such as enabled payment amounts. GET /api/user/topup/info. This does not create a payment.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => call(() => deps.client.get("/api/user/topup/info")),
  );

  server.registerTool(
    "get_subscription",
    {
      title: "My subscription",
      description: "Get the signed-in user's subscription state. GET /api/subscription/self.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () =>
      call(() =>
        deps.client.get("/api/subscription/self").then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken)),
      ),
  );

  server.registerTool(
    "list_subscription_plans",
    {
      title: "Subscription plans",
      description:
        "List subscription plans visible to the signed-in user. GET /api/subscription/plans. This does not purchase a plan.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () =>
      call(() =>
        deps.client
          .get("/api/subscription/plans")
          .then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken)),
      ),
  );

  server.registerTool(
    "get_affiliate",
    {
      title: "Affiliate code",
      description: "Get the signed-in user's affiliate code and related quota fields. GET /api/user/aff.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () =>
      call(() => deps.client.get("/api/user/aff").then((body) => presentPayload(body, deps.quotaPerUnit, deps.accessToken))),
  );

  server.registerTool(
    "get_checkin_status",
    {
      title: "Check-in status",
      description:
        "Get the signed-in user's check-in status. GET /api/user/checkin. This does not perform a check-in.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => call(() => deps.client.get("/api/user/checkin")),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "My async tasks",
      description:
        "List the signed-in user's asynchronous tasks (video, music, and similar jobs). GET /api/task/self.",
      inputSchema: z.object({
        ...pageFields,
        platform: z.string().max(64).optional(),
        task_id: z.string().max(128).optional(),
        status: z.string().max(64).optional(),
        action: z.string().max(64).optional(),
        start_timestamp: logFilterFields.start_timestamp,
        end_timestamp: logFilterFields.end_timestamp,
      }),
      annotations: READ_ONLY,
    },
    async (args) =>
      call(() => {
        assertTimeRange(args.start_timestamp, args.end_timestamp);
        return deps.client.get("/api/task/self", {
          ...pageQuery(args),
          platform: args.platform,
          task_id: args.task_id,
          status: args.status,
          action: args.action,
          start_timestamp: args.start_timestamp,
          end_timestamp: args.end_timestamp,
        });
      }),
  );

  server.registerTool(
    "list_drawings",
    {
      title: "My drawings",
      description: "List the signed-in user's Midjourney drawing records. GET /api/mj/self.",
      inputSchema: z.object({
        ...pageFields,
        mj_id: z.string().max(128).optional().describe("Optional Midjourney task id filter."),
      }),
      annotations: READ_ONLY,
    },
    async (args) =>
      call(() => deps.client.get("/api/mj/self", { ...pageQuery(args), mj_id: args.mj_id })),
  );
}

function binder() {
  return async function call(fn: () => Promise<unknown>) {
    try {
      const data = await fn();
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  };
}

function pageQuery(args: { page?: number; page_size?: number }): { p: number; page_size: number } {
  return { p: args.page ?? 1, page_size: args.page_size ?? 20 };
}

function logQuery(args: {
  type?: number;
  start_timestamp?: number;
  end_timestamp?: number;
  model_name?: string;
  token_name?: string;
  group?: string;
  request_id?: string;
  upstream_request_id?: string;
}): Record<string, string | number | undefined> {
  return {
    type: args.type,
    start_timestamp: args.start_timestamp,
    end_timestamp: args.end_timestamp,
    model_name: args.model_name,
    token_name: args.token_name,
    group: args.group,
    request_id: args.request_id,
    upstream_request_id: args.upstream_request_id,
  };
}

function assertTimeRange(start: number | undefined, end: number | undefined): void {
  if (start !== undefined && end !== undefined && end < start) {
    throw new Error("end_timestamp must be greater than or equal to start_timestamp");
  }
}
