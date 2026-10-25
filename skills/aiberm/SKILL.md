---
name: aiberm
description: >-
  Look up the signed-in user's Aiberm account at aiberm.com: balance (余额),
  models (模型), pricing, tokens (令牌), usage (用量), and top-ups. Use when the
  user asks about their Aiberm 余额, 模型, 令牌, 用量, or billing. Calls the
  Aiberm API with AIBERM_ACCESS_TOKEN (系统访问令牌) and AIBERM_USER_ID.
---

# Aiberm account

用户问 Aiberm 的余额、模型、令牌、用量或充值时，用 curl 只读调用 https://aiberm.com 的接口。

## Credentials

- `AIBERM_ACCESS_TOKEN`: the system access token (系统访问令牌) from 个人设置 (personal settings).
- `AIBERM_USER_ID`: the numeric `ID` shown at the top of 个人设置.

If either is missing, ask the user to export it. Never print the token. Do not use `curl -v` or `set -x`.

## Call the API

Every request sends both headers. Aiberm rejects account routes without `New-Api-User`, and the ID must belong to the token's user.

```bash
curl -sS -G "https://aiberm.com/api/log/self" \
  -H "Authorization: Bearer $AIBERM_ACCESS_TOKEN" \
  -H "New-Api-User: $AIBERM_USER_ID" \
  --data-urlencode "p=1" --data-urlencode "type=2"
```

Responses are `{"success": true, "message": "", "data": ...}`. `"success": false` is a failure even on HTTP 200. If the message mentions `New-Api-User`, `AIBERM_USER_ID` is wrong. `access token 无效` means the token is wrong or was reset.

Paginated `data` is `{page, page_size, total, items}`. The page parameter is `p` (from 1). `page_size` defaults to 10, max 100. Timestamps are unix seconds.

| Question | Request | Notes |
| --- | --- | --- |
| Profile, balance (余额) | `GET /api/user/self` | `quota` is the remaining balance, `used_quota` is total spent |
| Usable groups | `GET /api/user/self/groups` | `data` keyed by group: `{ratio, desc}`. `auto` has ratio `自动` |
| Callable models (模型) | `GET /api/user/models` | list of model names |
| Prices | `GET /api/pricing` | ~40 KB; filter by model name, for example with `jq` |
| Tokens (令牌) | `GET /api/token/` | `p`, `page_size`. Items include the **full** key |
| Search tokens | `GET /api/token/search` | `keyword` (name) or `token` (key); exact unless it has `%` |
| One token | `GET /api/token/{id}` | |
| Usage logs (用量) | `GET /api/log/self` | `p`, `page_size`, `type`, `start_timestamp`, `end_timestamp`, `model_name`, `token_name`, `group` |
| Usage total | `GET /api/log/self/stat` | same filters; sums consume logs only. `rpm`/`tpm` are the last 60 s |
| Hourly usage by model | `GET /api/data/self` | `start_timestamp` and `end_timestamp` required, at most 30 days apart |
| Top-up records | `GET /api/user/topup/self` | `p`, `page_size`, `keyword` (trade number) |
| Top-up options | `GET /api/user/topup/info` | read-only |

Log `type`: `0` all, `1` top-up, `2` consume, `3` manage, `4` system, `5` error, `6` refund.

## Money

`USD = quota / 500000`. This applies to every quota field: `quota`, `used_quota`, `aff_quota`, a token's `remain_quota`, and log `quota`. Do not subtract `used_quota` from `quota`.

Pricing rows from `/api/pricing`:

- `quota_type` 0: input USD per 1M tokens = `model_ratio * group_ratio * 2`. Output = input × `completion_ratio`.
- `quota_type` 1: USD per request = `model_price * group_ratio`.
- `official_input` / `official_output`: the vendor's list price in USD per 1M tokens, when set.

`/api/pricing` ignores the access token, so its `group_ratio` is the anonymous view. Use the user's ratio from `/api/user/self/groups`. A model is available in the groups listed in its `enable_groups`.

## Secrets

- Token responses contain full model keys. Never repeat one. Show `sk-` plus the first and last four characters, like `sk-abcd****wxyz`. To list tokens without keys: `| jq 'del(.data.items[].key)'`.
- The profile's `setting` can hold a webhook secret or Gotify token. Do not repeat those either.

## Do not call

- `GET /api/user/token`: it **resets** the system access token, and the current one stops working.
- Admin routes such as `/api/channel/`, `/api/option/`, `/api/redemption/`, `/api/log/`, and the user list `/api/user/`.
- Anything that is not a GET: payments, top-up codes, affiliate transfers, and token or account changes. Send the user to the Aiberm dashboard for those.
