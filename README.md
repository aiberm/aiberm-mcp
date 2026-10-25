# aiberm-mcp

MCP server for [New API](https://docs.newapi.ai) end users. It talks to one account — the account in the environment — and exposes that account's balance, groups, prices, tokens, logs, and related self-service reads.

It does not register admin tools: no channels, user lists, redemptions, system options, or key-reveal endpoints.

The default transport is stdio. A loopback Streamable HTTP endpoint is available when you pass `--http`.

## Requirements

- Node.js 20 or newer
- A New API dashboard access token (系统访问令牌 in personal settings). This is not an `sk-` relay key.
- The numeric user id of that same account (`GET /api/user/self` field `id`, or the id shown in the dashboard)

## Configure

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEW_API_BASE_URL` | yes | Origin only, for example `https://aiberm.com` |
| `NEW_API_ACCESS_TOKEN` | yes | Dashboard access token. Sent as `Authorization: Bearer …` |
| `NEW_API_USER_ID` | yes | Numeric user id. Sent as `New-Api-User` and must match the token's account |
| `NEW_API_QUOTA_PER_UNIT` | no | Quota units per 1 USD. Default `500000`, which is New API's default `QuotaPerUnit` |
| `MCP_TRANSPORT` | no | Set to `http` to serve Streamable HTTP instead of stdio |
| `PORT` | no | HTTP port. Default `3000`. `0` lets the OS pick a port |
| `MCP_HTTP_HOST` | no | Bind address. Default `127.0.0.1`. Only `127.0.0.1`, `localhost`, or `::1` |

Every upstream request includes both auth headers. Tokens are not written to logs. Copy `.env.example` if you want a local env file, and do not commit it.

`quota` on the user record is the **remaining** balance. `used_quota` is cumulative consumption. USD fields are `quota / NEW_API_QUOTA_PER_UNIT`. If the site changed `QuotaPerUnit`, set `NEW_API_QUOTA_PER_UNIT` to that value (also returned by the instance's `/api/status` as `quota_per_unit`).

Token list and token detail responses keep New API's masked key (`abcd**********wxyz`). Full keys and `sk-` secrets are redacted if they appear.

## Tools

All tools are read-only GETs scoped to the signed-in user.

| Tool | Upstream |
| --- | --- |
| `get_self` | `GET /api/user/self` |
| `get_balance` | `GET /api/user/self` (quota fields and USD) |
| `get_self_groups` | `GET /api/user/self/groups` |
| `get_models` | `GET /api/user/models` |
| `get_pricing` | `GET /api/pricing` (summarized; optional `model` and `group`) |
| `list_tokens` | `GET /api/token/` or `GET /api/token/search` |
| `get_token` | `GET /api/token/{id}` |
| `get_token_auto_groups` | `GET /api/token/auto-groups` |
| `list_logs` | `GET /api/log/self` |
| `get_usage_stats` | `GET /api/log/self/stat` |
| `get_usage_by_day` | `GET /api/data/self` |
| `get_usage_flow` | `GET /api/data/flow/self` |
| `list_topups` | `GET /api/user/topup/self` |
| `get_topup_info` | `GET /api/user/topup/info` |
| `get_subscription` | `GET /api/subscription/self` |
| `list_subscription_plans` | `GET /api/subscription/plans` |
| `get_affiliate` | `GET /api/user/aff` |
| `get_checkin_status` | `GET /api/user/checkin` |
| `list_tasks` | `GET /api/task/self` |
| `list_drawings` | `GET /api/mj/self` |

Log `type`: `0` all, `1` top-up, `2` consume, `3` manage, `4` system, `5` error, `6` refund. Timestamps are unix seconds. Pagination uses `page` and `page_size` (upstream `p` and `page_size`, max 100).

`get_pricing` reports USD per 1M tokens as `model_ratio * group_ratio * (1000000 / quota_per_unit)`. Per-request models (`quota_type` 1) use `model_price * group_ratio`. Pass `group` to apply that group's ratio; otherwise the displayed ratio is 1 and `group_ratio` is included so you can scale the numbers. The tool returns a page of models (default 25) rather than the raw catalog.

These paths are intentionally absent: channel and vendor management, all-user lists, redemptions, system options, log export of other users, `POST /api/token/{id}/key`, and any route that creates a payment, token, or access token.

## Build and run

```bash
npm install
npm test
npm run build
```

stdio, which is what Claude Desktop and Cursor launch:

```bash
export NEW_API_BASE_URL=https://aiberm.com
export NEW_API_ACCESS_TOKEN='your-dashboard-access-token'
export NEW_API_USER_ID='123'
node dist/index.js
```

The process waits on stdin. Logs go to stderr (`aiberm-mcp stdio ready`). A client then sends MCP `initialize` and `tools/list`.

Check registration without calling New API:

```bash
npm run dry-run
```

That prints the tool names and exits with an error if the registered set drifts.

Optional loopback HTTP (Streamable HTTP at `/mcp`). The process still uses the env credentials; do not publish the port.

```bash
node dist/index.js --http
# aiberm-mcp http listening on http://127.0.0.1:3000/mcp
```

Requests whose `Host` or `Origin` is not loopback receive 403. Clients that omit `Origin` (Cursor, Claude, `curl`) are accepted on the loopback bind.

## Claude Desktop

Add this to `claude_desktop_config.json`. Use the absolute path to `dist/index.js`.

```json
{
  "mcpServers": {
    "aiberm": {
      "command": "node",
      "args": ["/absolute/path/to/aiberm-mcp/dist/index.js"],
      "env": {
        "NEW_API_BASE_URL": "https://aiberm.com",
        "NEW_API_ACCESS_TOKEN": "your-dashboard-access-token",
        "NEW_API_USER_ID": "123"
      }
    }
  }
}
```

## Cursor

Project file `.cursor/mcp.json`, or the global MCP config:

```json
{
  "mcpServers": {
    "aiberm": {
      "command": "node",
      "args": ["/absolute/path/to/aiberm-mcp/dist/index.js"],
      "env": {
        "NEW_API_BASE_URL": "https://aiberm.com",
        "NEW_API_ACCESS_TOKEN": "your-dashboard-access-token",
        "NEW_API_USER_ID": "123"
      }
    }
  }
}
```

If the HTTP server is already running on localhost, Cursor can use the URL instead. Credentials stay in the server process, not in this snippet.

```json
{
  "mcpServers": {
    "aiberm": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

## Development

```bash
npm run dev          # stdio via tsx, same env vars as node dist/index.js
npm test             # unit tests, in-process tools/list, HTTP, and a stdio spawn
npm run build        # tsc to dist/
```

Upstream behavior follows current [QuantumNous/new-api](https://github.com/QuantumNous/new-api) user routes: `/api/user/self`, `/api/user/self/groups`, and `/api/pricing` are the ones called out in the [New API docs](https://docs.newapi.ai). Older instances that still require `New-Api-User` keep working because that header is always sent.
